import Schema from "@deepseek-ai/schemastery";
import { bindTypertRemote } from "@deepseek-ai/dsh-typert-protocol";
import { readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
//#region src/ide-files.ts
/**
* Host-side workspace file server for dsh-session-ide.
*
* Every operation is scoped to one dsh session's canonical working directory
* (`SessionHeader.cwd`): requested paths are workspace-relative, resolved
* lexically BEHIND the workspace root (no '..' segments, no absolute paths),
* and then checked against the realpath of the root so a symlink inside the
* workspace cannot smuggle a read/write outside it.
*
* Sizes are capped (`maxReadBytes` / `maxWriteBytes`) so the browser never
* receives a multi-gigabyte string; binary files (NUL bytes) answer with
* `binary: true` and empty content instead of a lossy UTF-8 blob.
*
* @module dsh-session-ide/ide-files
*/
/** Error category for user-visible file operations. */
var IdeFileError = class extends Error {
	/** Stable machine category. */
	kind;
	/** @param kind - machine category. @param message - user-facing message. */
	constructor(kind, message) {
		super(message);
		this.name = "IdeFileError";
		this.kind = kind;
	}
};
/** Workspace-scoped file operations for one host context. */
var IdeFileManager = class {
	ctx;
	config;
	/**
	* @param ctx - owning host context (session store access).
	* @param config - resolved plugin configuration.
	*/
	constructor(ctx, config) {
		this.ctx = ctx;
		this.config = config;
	}
	/** List one directory below the session workspace root. */
	async list(request) {
		this.assertEnabled();
		const root = await this.workspaceRoot(request.sessionId);
		const directory = this.resolveInside(root, request.path);
		let dirents;
		try {
			dirents = await readdir(directory, { withFileTypes: true });
		} catch (error) {
			const code = error.code;
			if (code === "ENOENT") throw new IdeFileError("not-found", `not-found: path ${JSON.stringify(request.path)} does not exist`);
			if (code === "ENOTDIR") throw new IdeFileError("not-a-directory", `not-a-directory: path ${JSON.stringify(request.path)} is not a directory`);
			throw new IdeFileError("io-error", `io-error: unable to list ${JSON.stringify(request.path)}: ${String(error)}`);
		}
		const entries = [];
		for (const entry of dirents) {
			if (this.config.ignore.includes(entry.name)) continue;
			if (entry.isDirectory()) {
				entries.push({
					name: entry.name,
					kind: "dir",
					size: null,
					mtime: null
				});
				continue;
			}
			if (entry.isSymbolicLink()) {
				entries.push({
					name: entry.name,
					kind: "link",
					size: null,
					mtime: null
				});
				continue;
			}
			if (entry.isFile()) {
				try {
					const info = await stat(join(directory, entry.name));
					entries.push({
						name: entry.name,
						kind: "file",
						size: info.size,
						mtime: Math.round(info.mtimeMs)
					});
				} catch {
					entries.push({
						name: entry.name,
						kind: "file",
						size: null,
						mtime: null
					});
				}
				continue;
			}
			if (entry.isBlockDevice() || entry.isCharacterDevice() || entry.isFIFO() || entry.isSocket()) continue;
		}
		entries.sort((left, right) => {
			if (left.kind === "dir" && right.kind !== "dir") return -1;
			if (left.kind !== "dir" && right.kind === "dir") return 1;
			return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
		});
		return {
			path: request.path === "" ? "" : normalizeRelative(request.path),
			entries
		};
	}
	/** Load one workspace-relative file as UTF-8 text. */
	async read(request) {
		this.assertEnabled();
		const root = await this.workspaceRoot(request.sessionId);
		const resolved = this.resolveInside(root, request.path);
		const target = await this.realInside(root, resolved, "read");
		let info;
		try {
			info = await stat(target);
		} catch (error) {
			if (error.code === "ENOENT") throw new IdeFileError("not-found", `not-found: file ${JSON.stringify(request.path)} does not exist`);
			throw new IdeFileError("io-error", `io-error: unable to stat ${JSON.stringify(request.path)}: ${String(error)}`);
		}
		if (info.isDirectory()) throw new IdeFileError("not-a-directory", `not-a-directory: path ${JSON.stringify(request.path)} is a directory`);
		if (info.size > this.config.maxReadBytes) throw new IdeFileError("too-large", `too-large: ${JSON.stringify(request.path)} is ${info.size} bytes (limit ${this.config.maxReadBytes})`);
		let buffer;
		try {
			buffer = await readFile(target);
		} catch (error) {
			throw new IdeFileError("io-error", `io-error: unable to read ${JSON.stringify(request.path)}: ${String(error)}`);
		}
		if (buffer.includes(0)) return {
			path: normalizeRelative(request.path),
			content: "",
			size: buffer.length,
			binary: true
		};
		return {
			path: normalizeRelative(request.path),
			content: buffer.toString("utf8"),
			size: buffer.length,
			binary: false
		};
	}
	/** Persist text back to one workspace-relative file. */
	async write(request) {
		this.assertEnabled();
		if (!this.config.writable) throw new IdeFileError("readonly", "readonly: the IDE is configured read-only");
		const bytes = Buffer.byteLength(request.content, "utf8");
		if (bytes > this.config.maxWriteBytes) throw new IdeFileError("too-large", `too-large: write is ${bytes} bytes (limit ${this.config.maxWriteBytes})`);
		const root = await this.workspaceRoot(request.sessionId);
		const resolved = this.resolveInside(root, request.path);
		let target;
		try {
			target = await this.realInside(root, resolved, "write");
		} catch (error) {
			if (error instanceof IdeFileError && error.kind === "not-found") {
				const directory = dirname(resolved);
				const dirReal = await this.realInside(root, directory, "write");
				target = join(dirReal, basename(resolved));
			} else throw error;
		}
		try {
			await writeFile(target, request.content, "utf8");
		} catch (error) {
			throw new IdeFileError("io-error", `io-error: unable to write ${JSON.stringify(request.path)}: ${String(error)}`);
		}
		return {
			path: normalizeRelative(request.path),
			size: bytes
		};
	}
	assertEnabled() {
		if (!this.config.enabled) throw new IdeFileError("disabled", "disabled: the session IDE is disabled in plugin configuration");
	}
	/** Resolve the session's canonical workspace root (realpath, cached). */
	async workspaceRoot(sessionId) {
		const session = this.ctx.sessions.get(sessionId);
		if (session === void 0) throw new IdeFileError("session-not-found", `session-not-found: session ${JSON.stringify(sessionId)} not found`);
		const cwd = session.header.cwd;
		if (cwd === void 0 || cwd === "") throw new IdeFileError("cwd-unavailable", `cwd-unavailable: session ${JSON.stringify(sessionId)} has no working directory`);
		try {
			return await realpath(cwd);
		} catch (error) {
			throw new IdeFileError("cwd-unavailable", `cwd-unavailable: session ${JSON.stringify(sessionId)} cwd is not resolvable: ${String(error)}`);
		}
	}
	/** Lexically resolve a workspace-relative path behind `root`. */
	resolveInside(root, rel) {
		if (rel === "") return root;
		if (isAbsolute(rel) || rel.includes("\0")) throw new IdeFileError("path-outside-workspace", `path-outside-workspace: ${JSON.stringify(rel)} is not workspace-relative`);
		const segments = rel.split("/");
		for (const segment of segments) if (segment === "" || segment === "." || segment === "..") throw new IdeFileError("path-outside-workspace", `path-outside-workspace: ${JSON.stringify(rel)} escapes the workspace`);
		const resolved = resolve(root, ...segments);
		if (resolved !== root && !resolved.startsWith(root + sep)) throw new IdeFileError("path-outside-workspace", `path-outside-workspace: ${JSON.stringify(rel)} escapes the workspace`);
		return resolved;
	}
	/** Resolve the realpath of an existing path and assert it stays in the root. */
	async realInside(root, resolved, op) {
		let real;
		try {
			real = await realpath(resolved);
		} catch (error) {
			if (error.code === "ENOENT") throw new IdeFileError("not-found", `not-found: ${op} target does not exist`);
			throw new IdeFileError("io-error", `io-error: unable to resolve ${op} target: ${String(error)}`);
		}
		if (real !== root && !real.startsWith(root + sep)) throw new IdeFileError("path-outside-workspace", `path-outside-workspace: ${op} target escapes the workspace`);
		return real;
	}
};
/** Normalize a workspace-relative path for display (forward slashes only). */
function normalizeRelative(path) {
	return path.split(sep).join("/");
}
//#endregion
//#region src/shared/remote.ts
/** Cordis service key of the IDE receiver, also the wire namespace. */
const IDE_SERVICE = "sessionIde";
/** Wire namespace of every IDE invocation. */
const IDE_NAMESPACE = IDE_SERVICE;
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function isString(value) {
	return typeof value === "string";
}
/** Valid non-empty short identifier (session id). */
function isId(value) {
	return isString(value) && value.length > 0 && value.length <= 256 && !value.includes("\0");
}
/** Workspace-relative path ('' for root); no NUL, bounded length. */
function isPath(value) {
	return isString(value) && value.length <= 4096 && !value.includes("\0");
}
/** Bounded integer file size. */
function isSize(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
/** Directory entry validator. */
const entrySchema = { parse(value) {
	if (!isRecord(value)) throw new TypeError("directory entry must be a plain object");
	const { name, kind, size, mtime } = value;
	if (!isString(name) || name.length === 0 || name.length > 512 || name.includes("\0")) throw new TypeError("directory entry name must be a non-empty bounded string");
	if (kind !== "file" && kind !== "dir" && kind !== "link") throw new TypeError("directory entry kind must be file, dir, or link");
	if (size !== null && !isSize(size)) throw new TypeError("directory entry size must be a non-negative integer or null");
	if (mtime !== null && !isSize(mtime)) throw new TypeError("directory entry mtime must be a non-negative integer or null");
	return {
		name,
		kind,
		size,
		mtime
	};
} };
/** Path-only request validator (list thin wrapper below). */
function parsePathRequest(value) {
	if (!isRecord(value)) throw new TypeError("request must be a plain object");
	const { sessionId, path } = value;
	if (!isId(sessionId)) throw new TypeError("request sessionId must be a non-empty id string");
	if (!isPath(path)) throw new TypeError("request path must be a bounded string without NUL");
	return {
		sessionId,
		path
	};
}
/** The full descriptor set, registered by the host and mounted by the client. */
const IDE_DESCRIPTORS = [
	{
		id: "dsh-session-ide#sessionIde.list",
		service: IDE_SERVICE,
		namespace: IDE_NAMESPACE,
		method: "list",
		invocation: { kind: "direct" },
		parameters: [{
			name: "request",
			wire: "request",
			source: "json",
			codec: {
				mode: "strict",
				typeSymbol: "dsh-session-ide#ListRequest",
				schema: { parse: (value) => parsePathRequest(value) }
			}
		}],
		result: {
			mode: "strict",
			typeSymbol: "dsh-session-ide#ListResult",
			schema: { parse(value) {
				if (!isRecord(value)) throw new TypeError("list result must be a plain object");
				const { path, entries } = value;
				if (!isPath(path)) throw new TypeError("list result path must be a bounded string");
				if (!Array.isArray(entries)) throw new TypeError("list result entries must be an array");
				if (entries.length > 1e5) throw new TypeError("list result entries array is unreasonably large");
				return {
					path,
					entries: entries.map((entry) => entrySchema.parse(entry))
				};
			} }
		}
	},
	{
		id: "dsh-session-ide#sessionIde.read",
		service: IDE_SERVICE,
		namespace: IDE_NAMESPACE,
		method: "read",
		invocation: { kind: "direct" },
		parameters: [{
			name: "request",
			wire: "request",
			source: "json",
			codec: {
				mode: "strict",
				typeSymbol: "dsh-session-ide#ReadRequest",
				schema: { parse: (value) => parsePathRequest(value) }
			}
		}],
		result: {
			mode: "strict",
			typeSymbol: "dsh-session-ide#ReadResult",
			schema: { parse(value) {
				if (!isRecord(value)) throw new TypeError("read result must be a plain object");
				const { path, content, size, binary } = value;
				if (!isPath(path)) throw new TypeError("read result path must be a bounded string");
				if (!isString(content) || content.length > 67108864) throw new TypeError("read result content must be a bounded string");
				if (!isSize(size)) throw new TypeError("read result size must be a non-negative integer");
				if (typeof binary !== "boolean") throw new TypeError("read result binary must be a boolean");
				return {
					path,
					content,
					size,
					binary
				};
			} }
		}
	},
	{
		id: "dsh-session-ide#sessionIde.write",
		service: IDE_SERVICE,
		namespace: IDE_NAMESPACE,
		method: "write",
		invocation: { kind: "direct" },
		parameters: [{
			name: "request",
			wire: "request",
			source: "json",
			codec: {
				mode: "strict",
				typeSymbol: "dsh-session-ide#WriteRequest",
				schema: { parse(value) {
					if (!isRecord(value)) throw new TypeError("write request must be a plain object");
					const { sessionId, path, content } = value;
					if (!isId(sessionId)) throw new TypeError("write request sessionId must be a non-empty id string");
					if (!isPath(path)) throw new TypeError("write request path must be a bounded string without NUL");
					if (!isString(content) || content.length > 16777216) throw new TypeError("write request content must be a bounded string");
					return {
						sessionId,
						path,
						content
					};
				} }
			}
		}],
		result: {
			mode: "strict",
			typeSymbol: "dsh-session-ide#WriteResult",
			schema: { parse(value) {
				if (!isRecord(value)) throw new TypeError("write result must be a plain object");
				const { path, size } = value;
				if (!isPath(path)) throw new TypeError("write result path must be a bounded string");
				if (!isSize(size)) throw new TypeError("write result size must be a non-negative integer");
				return {
					path,
					size
				};
			} }
		}
	}
];
//#endregion
//#region src/index.ts
/**
* Host (Node) half of dsh-session-ide.
*
* Registers the `sessionIde` Typert receiver behind `ctx.typert`, so the
* gateway claims `/api/sessionIde/<method>` and dispatches to it: list/read/
* write scoped to one dsh session's canonical working directory
* (`SessionHeader.cwd`), with containment and size caps enforced host-side
* ({@link IdeFileManager}).
*
* The browser half mounts the same descriptors and drives the explorer and
* editor through the client Remote; nothing here requires a model tool or
* prompt — this is a human-controlled workspace IDE, one per session.
*
* Configuration: `enabled` (default true) turns the whole surface off at the
* host; `writable` (default true) allows edits — set false for read-only
* browsing; `maxReadBytes`/`maxWriteBytes` cap payload sizes; `ignore` lists
* entry names hidden from the explorer.
*/
const name = "session-ide";
/** Services that must be mounted before this plugin runs. */
const inject = ["sessions", "typert"];
const Config = Schema.object({
	enabled: Schema.boolean().default(true),
	writable: Schema.boolean().default(true),
	maxReadBytes: Schema.number().min(1024).max(67108864).default(1048576),
	maxWriteBytes: Schema.number().min(1024).max(134217728).default(4194304),
	ignore: Schema.array(Schema.string()).default([
		"node_modules",
		".git",
		"dist",
		"coverage",
		".next",
		"target"
	])
});
/** Empty model for the Typert contribution: no generated reflection is claimed. */
const EMPTY_MODEL = {
	services: [],
	events: [],
	objects: []
};
/**
* Mount the session-ide plugin.
* @param ctx - the host context.
* @param config - resolved plugin config (the loader passes the fully resolved value).
*/
async function apply(ctx, config) {
	const manager = new IdeFileManager(ctx, config);
	const receiver = {
		typertRemote: void 0,
		list: (request) => manager.list(request),
		read: (request) => manager.read(request),
		write: (request) => manager.write(request)
	};
	receiver.typertRemote = bindTypertRemote(receiver, IDE_SERVICE, { namespace: IDE_SERVICE });
	ctx.provide(IDE_SERVICE, receiver);
	const contribution = {
		package: "dsh-session-ide",
		face: "host",
		schemas: [],
		model: EMPTY_MODEL,
		invocations: IDE_DESCRIPTORS
	};
	ctx.typert.register(contribution);
}
//#endregion
export { Config, IdeFileError, IdeFileManager, apply, inject, name };

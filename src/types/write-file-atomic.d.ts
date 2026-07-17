/**
 * Minimal ambient types for write-file-atomic@7 (used by src/state/map-store.ts).
 *
 * Why this file exists: write-file-atomic v7 ships NO TypeScript types and
 * @types/write-file-atomic targets the v4 API — installing it would add an
 * unaudited dep for a stale surface (minimal supply-chain rule for a security
 * tool). This declaration covers exactly the surface mrclean calls, verified
 * against node_modules/write-file-atomic/lib/index.js (v7.0.1):
 *   - promise call shape: writeFileAtomic(filename, data, options?)
 *   - options.fsync (default true — `options.fsync !== false` guard in source)
 *   - options.mode (passed to fs.open then enforced via fs.chmod)
 *
 * The runtime import stays confined to src/state/ (import-graph fence, 09-07).
 */
declare module 'write-file-atomic' {
  interface WriteFileAtomicOptions {
    /** Ownership applied to the tmp file; false disables the chown step. */
    chown?: { uid: number; gid: number } | false
    /** Encoding for string data (ignored for Buffer/TypedArray input). */
    encoding?: BufferEncoding
    /**
     * fsync the tmp file before rename. Defaults to TRUE — mrclean's map
     * writes pass `fsync: false` deliberately (Pitfall 2: +6-8 ms inside the
     * lock; torn state fails GCM auth and reads as map-absent).
     */
    fsync?: boolean
    /** File mode for the tmp file (open + chmod). */
    mode?: number | false
    /** Test seam: invoked with the tmp file path right after creation. */
    tmpfileCreated?: (tmpfile: string) => void | Promise<void>
  }

  function writeFileAtomic(
    filename: string,
    data: string | NodeJS.ArrayBufferView,
    options?: WriteFileAtomicOptions | BufferEncoding,
  ): Promise<void>

  export = writeFileAtomic
}

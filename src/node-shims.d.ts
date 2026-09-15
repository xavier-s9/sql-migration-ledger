// Hand-rolled ambient types for the handful of Node builtins this tool uses.
// Avoids pulling in @types/node just to get a few function signatures.

declare const process: {
  argv: string[];
  exitCode: number | undefined;
  exit(code?: number): never;
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
};

declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

declare module 'node:fs' {
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string, encoding: 'utf8'): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
}

declare module 'node:crypto' {
  export function createHash(algorithm: string): {
    update(data: string): { digest(encoding: string): string };
  };
}

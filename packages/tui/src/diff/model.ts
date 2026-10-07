export type DiffLine = { kind: 'add' | 'del' | 'ctx'; oldNo?: number; newNo?: number; text: string };
export type Hunk = { oldStart: number; newStart: number; header: string; lines: DiffLine[] };
export type DiffFile = { oldPath?: string; newPath: string; status: 'added' | 'deleted' | 'modified' | 'renamed' | 'binary'; hunks: Hunk[]; adds: number; dels: number; /** Lines left out of `hunks` because of the per-file cap. */ moreLines?: number };
export interface Limits { maxFiles?: number; maxLinesPerFile?: number }
export const MAX_FILES = 200; export const MAX_LINES = 2000;

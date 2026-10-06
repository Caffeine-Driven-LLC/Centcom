import type { EngineId } from '../types.js';

export interface HookDef { matcher?: string; command: string; timeout_s?: number }
export type IssueCode = 'unknown_event' | 'too_many' | 'too_long' | 'bad_timeout' | 'command_not_found' | 'bad_matcher';
export interface ValidationIssue { code: IssueCode; message: string }
export type HookScope = 'project' | 'local' | 'user';
export type ReviewFlag = 'never_confirmed' | 'changed_since_confirmed';
export interface HookEntry { engine: EngineId; scope: HookScope; path: string; event: string; /** Position among this event's hooks, in file order. */ index: number; def: HookDef; issues: ValidationIssue[]; /** Shared project file whose hooks were not confirmed here: review before running. */ review?: ReviewFlag }
export type HooksList = { supported: true; entries: HookEntry[]; banner?: 'unverified_version' } | { supported: false; reason: string };
export interface HookTemplate { id: string; title: string; description: string; event: string; matcher?: string; command: string; timeout_s?: number; /** A choice the user makes; `{{name}}` in the command is replaced. */ params?: { name: string; label: string; choices: string[] }[]; sessionOnly?: boolean }
export type HooksOp = { kind: 'add' | 'update' | 'remove'; engine: EngineId; scope: HookScope; event: string; def?: HookDef; index?: number; root?: string };
export interface HooksPlan { path: string; scope: HookScope; engine: EngineId; baseSha: string | null; newText: string; diff: string; planHash: string; warnings: string[]; issues: ValidationIssue[] }
export interface HooksApplyReport { path: string; backup?: string; removedBackups: string[] }

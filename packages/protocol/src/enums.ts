import { z } from 'zod';

export const ChildStatus = z.enum(['at_home', 'left_home', 'at_friend']);
export type ChildStatus = z.infer<typeof ChildStatus>;

export const Availability = z.enum(['available', 'busy', 'on_my_way', 'unavailable']);
export type Availability = z.infer<typeof Availability>;

export const RingerMode = z.enum(['normal', 'vibrate', 'silent', 'unknown']);
export type RingerMode = z.infer<typeof RingerMode>;

export const MessageKind = z.enum(['text', 'gif', 'sticker', 'drawing']);
export type MessageKind = z.infer<typeof MessageKind>;

export const MemberType = z.enum(['user', 'child']);
export type MemberType = z.infer<typeof MemberType>;

export const TokenScope = z.enum(['parent', 'device', 'child']);
export type TokenScope = z.infer<typeof TokenScope>;

// Matches the `user_role` pg enum in DATABASE.md. No TS enums (CONVENTIONS.md §1).
export const USER_ROLES = ['student', 'faculty', 'alumni', 'admin'] as const;

export type Role = (typeof USER_ROLES)[number];

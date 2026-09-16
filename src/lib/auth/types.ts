/** The signed-in user, as much of it as client components get. */
export interface SessionUser {
  userId: string;
  email: string | null;
}

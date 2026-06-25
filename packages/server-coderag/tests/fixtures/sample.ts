export interface UserService {
  getUser(id: string): User;
}

export class UserManager implements UserService {
  private users: Map<string, User> = new Map();

  getUser(id: string): User {
    const user = this.users.get(id);
    if (!user) throw new Error(`User ${id} not found`);
    return user;
  }

  addUser(user: User): void {
    this.users.set(user.id, user);
  }
}

export function createAdmin(name: string): User {
  return { id: 'admin', name, role: 'admin' };
}

export const greet = (name: string): string => `Hello, ${name}!`;

interface User {
  id: string;
  name: string;
  role: string;
}

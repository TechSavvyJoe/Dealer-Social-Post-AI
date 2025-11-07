import { pb } from './pocketbaseClient';

export async function signIn(email: string, password: string) {
  const auth = await pb.collection('users').authWithPassword(email, password);
  console.log('[authService] signIn response:', auth);
  console.log('[authService] user record:', auth.record);
  console.log('[authService] user role:', auth.record.role);
  
  // Check if role exists
  if (!auth.record.role) {
    throw new Error('User account has no role assigned. Please contact administrator.');
  }
  
  return {
    user: auth.record,
    role: auth.record.role as 'manager' | 'salesman',
  };
}

export async function signUp(
  email: string,
  password: string,
  passwordConfirm: string,
  role: 'manager' | 'salesman',
  name?: string
) {
  const user = await pb.collection('users').create({
    email,
    password,
    passwordConfirm,
    role,
    name: name || email.split('@')[0], // Use part before @ as default name
    emailVisibility: true,
  });
  return user;
}

export async function signOut() {
  pb.authStore.clear();
}

export function getCurrentUser() {
  return pb.authStore.model;
}

export function isAuthenticated() {
  return pb.authStore.isValid;
}

export function getUserRole(): 'manager' | 'salesman' | null {
  const user = pb.authStore.model;
  return user ? (user.role as 'manager' | 'salesman') : null;
}

import { useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { UserPlus, Edit2, Trash2, Mail, Shield, User } from 'lucide-react';

interface User {
  id: string;
  email: string;
  name?: string;
  role: 'manager' | 'salesman';
  created: string;
  updated: string;
}

interface UserManagementProps {
  users: User[];
  onCreateUser: (email: string, password: string, role: 'manager' | 'salesman', name?: string) => Promise<void>;
  onUpdateUser: (id: string, email: string, role: 'manager' | 'salesman', name?: string) => Promise<void>;
  onDeleteUser: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  currentUserId?: string;
}

export function UserManagement({ 
  users, 
  onCreateUser, 
  onUpdateUser, 
  onDeleteUser, 
  onRefresh,
  currentUserId 
}: UserManagementProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  
  // Create user form
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [newRole, setNewRole] = useState<'manager' | 'salesman'>('salesman');
  
  // Edit user form
  const [editEmail, setEditEmail] = useState('');
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<'manager' | 'salesman'>('salesman');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreateUser = async () => {
    if (!newEmail || !newPassword || !newPasswordConfirm) {
      setError('Please fill in all fields');
      return;
    }
    
    if (newPassword !== newPasswordConfirm) {
      setError('Passwords do not match');
      return;
    }
    
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      await onCreateUser(newEmail, newPassword, newRole, newName || undefined);
      setIsCreateOpen(false);
      setNewEmail('');
      setNewName('');
      setNewPassword('');
      setNewPasswordConfirm('');
      setNewRole('salesman');
      await onRefresh();
    } catch (err: any) {
      setError(err.message || 'Failed to create user');
    } finally {
      setLoading(false);
    }
  };

  const handleEditUser = async () => {
    if (!selectedUser || !editEmail) {
      setError('Email is required');
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      await onUpdateUser(selectedUser.id, editEmail, editRole, editName || undefined);
      setIsEditOpen(false);
      setSelectedUser(null);
      await onRefresh();
    } catch (err: any) {
      setError(err.message || 'Failed to update user');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;

    setLoading(true);
    setError('');
    
    try {
      await onDeleteUser(selectedUser.id);
      setIsDeleteOpen(false);
      setSelectedUser(null);
      await onRefresh();
    } catch (err: any) {
      setError(err.message || 'Failed to delete user');
    } finally {
      setLoading(false);
    }
  };

  const openEditDialog = (user: User) => {
    setSelectedUser(user);
    setEditEmail(user.email);
    setEditName(user.name || '');
    setEditRole(user.role);
    setError('');
    setIsEditOpen(true);
  };

  const openDeleteDialog = (user: User) => {
    setSelectedUser(user);
    setError('');
    setIsDeleteOpen(true);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                User Management
              </CardTitle>
              <CardDescription>
                Manage system users and their roles
              </CardDescription>
            </div>
            <Button onClick={() => setIsCreateOpen(true)}>
              <UserPlus className="w-4 h-4 mr-2" />
              Add User
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {users.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No users found
              </div>
            ) : (
              <div className="space-y-2">
                {users.map((user) => {
                  const displayName =
                    user.name?.trim() ||
                    user.email?.split?.('@')?.[0] ||
                    'Unknown User';
                  const displayEmail = user.email || 'No email on file';
                  const displayRole = user.role === 'salesman' ? 'Salesperson' : 'Manager';

                  return (
                    <Card key={user.id} className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4 flex-1">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <User className="w-4 h-4 text-muted-foreground" />
                              <span className="font-semibold text-lg">{displayName}</span>
                              {user.id === currentUserId && (
                                <Badge variant="outline" className="text-xs">You</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <Mail className="w-3 h-3 text-muted-foreground" />
                              <span className="text-sm text-muted-foreground">{displayEmail}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <Shield className="w-3 h-3 text-muted-foreground" />
                              <span className="text-sm text-muted-foreground capitalize">
                                {displayRole}
                              </span>
                            </div>
                          </div>
                          <Badge variant={user.role === 'manager' ? 'default' : 'secondary'}>
                            {displayRole}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(user)}
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openDeleteDialog(user)}
                            disabled={user.id === currentUserId}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
            <DialogDescription>
              Add a new user to the system. They will be able to log in with the email and password you set.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                type="text"
                placeholder="John Doe"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Optional - will use email prefix if not provided
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="user@dealership.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Minimum 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="passwordConfirm">Confirm Password</Label>
              <Input
                id="passwordConfirm"
                type="password"
                placeholder="Re-enter password"
                value={newPasswordConfirm}
                onChange={(e) => setNewPasswordConfirm(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={newRole === 'salesman' ? 'default' : 'outline'}
                  className="flex-1"
                  onClick={() => setNewRole('salesman')}
                >
                  Salesperson
                </Button>
                <Button
                  type="button"
                  variant={newRole === 'manager' ? 'default' : 'outline'}
                  className="flex-1"
                  onClick={() => setNewRole('manager')}
                >
                  Manager
                </Button>
              </div>
            </div>
            
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">
                {error}
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateUser} disabled={loading}>
              {loading ? 'Creating...' : 'Create User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update user email and role. Password cannot be changed here.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                type="text"
                placeholder="John Doe"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="edit-role">Role</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={editRole === 'salesman' ? 'default' : 'outline'}
                  className="flex-1"
                  onClick={() => setEditRole('salesman')}
                >
                  Salesperson
                </Button>
                <Button
                  type="button"
                  variant={editRole === 'manager' ? 'default' : 'outline'}
                  className="flex-1"
                  onClick={() => setEditRole('manager')}
                >
                  Manager
                </Button>
              </div>
            </div>
            
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">
                {error}
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditUser} disabled={loading}>
              {loading ? 'Updating...' : 'Update User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Dialog */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this user? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          
          {selectedUser && (
            <div className="py-4">
              <Card className="p-4 bg-destructive/10">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  <span className="font-medium">{selectedUser.email}</span>
                  <Badge variant="outline">{selectedUser.role}</Badge>
                </div>
              </Card>
            </div>
          )}
          
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">
              {error}
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteUser} disabled={loading}>
              {loading ? 'Deleting...' : 'Delete User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

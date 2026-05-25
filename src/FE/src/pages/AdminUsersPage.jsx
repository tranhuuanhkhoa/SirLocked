import { useEffect, useState } from 'react';
import { getAdminUsers, lockUser, unlockUser } from '../api/adminApi';

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await getAdminUsers();
      setUsers(response.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const updateStatus = async (user) => {
    if (user.status === 'LOCKED') {
      await unlockUser(user.id);
    } else {
      await lockUser(user.id);
    }
    await loadUsers();
  };

  return (
    <section className="panel">
      <p className="eyebrow">Admin</p>
      <h1>User Management</h1>
      {loading && <p>Loading users...</p>}
      {error && <div className="error">{error}</div>}
      {!loading && !error && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.fullName}</td>
                  <td>{user.email}</td>
                  <td>{user.role}</td>
                  <td><span className={`badge ${user.status.toLowerCase()}`}>{user.status}</span></td>
                  <td>
                    <button onClick={() => updateStatus(user)}>
                      {user.status === 'LOCKED' ? 'Unlock' : 'Lock'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && <p>No users found.</p>}
        </div>
      )}
    </section>
  );
}

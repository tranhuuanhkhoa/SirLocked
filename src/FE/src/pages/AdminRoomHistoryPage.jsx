import { useEffect, useState } from 'react';
import { getAdminRooms } from '../api/adminApi';
import { navigate } from '../hooks/useNavigate';

export default function AdminRoomHistoryPage() {
  const [rooms, setRooms] = useState([]);
  const [error, setError] = useState('');

  const load = async () => {
    const response = await getAdminRooms();
    setRooms(response.data || []);
  };

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  return (
    <section className="panel">
      <p className="eyebrow">Member 5</p>
      <h1>Room History</h1>
      <div className="actions">
        <button className="secondary" onClick={() => load().catch((err) => setError(err.message))}>Refresh</button>
        <button className="secondary" onClick={() => navigate('/admin/dashboard')}>Dashboard</button>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Case</th>
              <th>Status</th>
              <th>Players</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((room) => (
              <tr key={room.id}>
                <td>{room.roomCode}</td>
                <td>{room.caseId}</td>
                <td>{room.status}</td>
                <td>{room.players.map((player) => player.fullName).join(', ') || 'Empty'}</td>
                <td>
                  <button className="secondary" onClick={() => navigate(`/rooms/lobby?roomId=${room.id}`)}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
            {rooms.length === 0 && (
              <tr>
                <td colSpan="5">No rooms yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

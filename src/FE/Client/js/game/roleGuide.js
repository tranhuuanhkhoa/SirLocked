const stepIds = ['investigate', 'notebook', 'compare'];

/** Local tutorial progress records only actions performed by this browser, never shared room state. */
export function createRoleGuide({ storage, roomId, userId, role }) {
  const key = `sirlocked.roleGuide.v1.${roomId}.${userId}.${role}`;
  let completed = new Set();
  let dismissed = true;
  try {
    const saved = JSON.parse(storage.getItem(key) ?? 'null');
    completed = new Set(Array.isArray(saved?.completed) ? saved.completed.filter((id) => stepIds.includes(id)) : []);
    dismissed = saved?.dismissed !== false;
  } catch { /* A disabled or corrupt local store must not block the game. */ }

  function save() {
    try { storage.setItem(key, JSON.stringify({ completed: [...completed], dismissed })); } catch { /* Memory-only progress is sufficient. */ }
  }

  return {
    snapshot: () => ({ completed: [...completed], dismissed }),
    setDismissed(value) { dismissed = value; save(); },
    record(action) {
      const step = action === 'notebook' || action === 'compare'
        ? action
        : role === 'INVESTIGATOR' && (action === 'inspect' || action === 'photo')
          || role === 'INTERROGATOR' && action === 'ask'
          ? 'investigate'
          : null;
      if (!step || completed.has(step)) return false;
      completed.add(step);
      save();
      return true;
    },
  };
}

export function roleGuideSteps(role, tr) {
  return [
    {
      id: 'investigate',
      title: role === 'INVESTIGATOR' ? tr('Examine the scene', 'Khám nghiệm hiện trường') : tr('Question a witness', 'Hỏi nhân chứng'),
      text: role === 'INVESTIGATOR'
        ? tr('Click the floor to walk. Click an object to approach and inspect it, or frame a clue with the Camera (Z).', 'Nhấp vào sàn để di chuyển. Nhấp vật thể để đến gần và kiểm tra, hoặc dùng Máy ảnh (Z) chụp manh mối.')
        : tr('Click a witness to approach, then choose a question or conversation reply.', 'Nhấp nhân chứng để đến gần, rồi chọn câu hỏi hoặc câu trả lời hội thoại.'),
    },
    {
      id: 'notebook',
      title: tr('Read your case file', 'Đọc hồ sơ của bạn'),
      text: tr('Open the Case File. In Crack cases, your notes are private until a joint review discloses them.', 'Mở Hồ sơ vụ án. Trong vụ án Crack, ghi chú của bạn là riêng tư cho đến khi được công bố trong đối chất chung.'),
    },
    {
      id: 'compare',
      title: tr('Ask your partner to compare', 'Cùng đồng đội đối chiếu'),
      text: tr('Use Team ping → Let’s compare, or offer a clue or testimony in a joint review. Describe the details to your partner.', 'Chọn Gọi đồng đội → Cần đối chiếu, hoặc đưa chứng cứ hay lời khai vào đối chất chung. Hãy mô tả chi tiết cho đồng đội.'),
    },
  ];
}

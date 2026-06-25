export function escapeHtml(value) {
  const htmlMap = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  };

  return String(value ?? "").replace(/[&<>"']/g, (char) => htmlMap[char]);
}

export function getResultMedal(rank) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return "🎁";
}

export function buildDiscordResultsText(winners, prizes, title = "KẾT QUẢ ĐUA THẦN THÚ - SỰ KIỆN QUAY SỐ BAN HỘI") {
  const racers = Array.isArray(winners) ? winners : [];
  const prizeList = Array.isArray(prizes) ? prizes : [];
  let text = `🏆 *** ${title} *** 🏆\n\n`;

  racers.slice(0, prizeList.length).forEach((racer, index) => {
    const rank = index + 1;
    const prizeText = prizeList[index] || `Giải ${rank}`;
    text += `${getResultMedal(rank)} **Hạng ${rank}**: **${racer.name}** [${racer.emoji}] (Phần thưởng: *${prizeText}*)\n`;
  });

  return `${text}\n✨ Chúc mừng các chiến binh đã chiến thắng cuộc đua ma thuật!`;
}

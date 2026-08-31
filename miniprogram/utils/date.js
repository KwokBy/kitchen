function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function dateChoices() {
  const today = new Date();
  return [
    { label: '今天', value: formatDate(today) },
    { label: '明天', value: formatDate(addDays(today, 1)) },
    { label: '后天', value: formatDate(addDays(today, 2)) },
    { label: '周末', value: formatDate(addDays(today, (6 - today.getDay() + 7) % 7 || 7)) }
  ];
}

module.exports = { formatDate, addDays, dateChoices };

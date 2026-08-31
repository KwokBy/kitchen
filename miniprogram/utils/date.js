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
  const dayOfWeek = today.getDay();
  const saturdayDistance = (6 - dayOfWeek + 7) % 7;
  const sundayDistance = (7 - dayOfWeek) % 7;
  return [
    { label: '今天', value: formatDate(today) },
    { label: '明天', value: formatDate(addDays(today, 1)) },
    { label: '周六', value: formatDate(addDays(today, saturdayDistance)) },
    { label: '周日', value: formatDate(addDays(today, sundayDistance)) }
  ].filter((item, index, all) => all.findIndex(candidate => candidate.value === item.value) === index);
}

module.exports = { formatDate, addDays, dateChoices };

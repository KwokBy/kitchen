function parseAmount(text) {
  const match = String(text || '').trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(.+)$/);
  return match ? { amount: Number(match[1]), unit: match[2].trim() } : null;
}

function parseRequirement(text) {
  const value = String(text || '').trim();
  const match = value.match(/^(.+?)\s+([0-9]+(?:\.[0-9]+)?\s*.+)$/);
  if (!match) return { name: value.split(/\s+/)[0], amount: null, unit: '', text: value };
  const parsed = parseAmount(match[2]);
  return { name: match[1].trim(), amount: parsed ? parsed.amount : null, unit: parsed ? parsed.unit : '', text: value };
}

function formatAmount(amount) {
  return Number.isInteger(amount) ? String(amount) : String(Number(amount.toFixed(2)));
}

function inventoryTotals(inventory) {
  const totals = {};
  inventory.forEach(item => {
    const parsed = parseAmount(item.quantity);
    if (!totals[item.name]) totals[item.name] = { name: item.name, units: {}, raw: [] };
    totals[item.name].raw.push(item.quantity);
    if (parsed) totals[item.name].units[parsed.unit] = (totals[item.name].units[parsed.unit] || 0) + parsed.amount;
  });
  return totals;
}

function buildBasket(dishes, inventory) {
  const stock = inventoryTotals(inventory);
  const groups = {};
  dishes.forEach(dish => (dish.ingredients || []).forEach(text => {
    const requirement = parseRequirement(text);
    if (!requirement.name) return;
    if (!groups[requirement.name]) groups[requirement.name] = { name: requirement.name, units: {}, loose: [], dishNames: [] };
    const group = groups[requirement.name];
    if (requirement.amount !== null) group.units[requirement.unit] = (group.units[requirement.unit] || 0) + requirement.amount;
    else group.loose.push(text.replace(requirement.name, '').trim() || '适量');
    if (!group.dishNames.includes(dish.name)) group.dishNames.push(dish.name);
  }));

  return Object.values(groups).map(group => {
    const available = stock[group.name];
    const needs = Object.entries(group.units);
    const needParts = needs.map(([unit, amount]) => `${formatAmount(amount)}${unit}`).concat(group.loose);
    const shortages = needs.filter(([unit, amount]) => !available || (available.units[unit] || 0) < amount)
      .map(([unit, amount]) => `${formatAmount(Math.max(0, amount - ((available && available.units[unit]) || 0)))}${unit}`);
    const hasLooseShortage = group.loose.length > 0 && !available;
    const tone = !available ? 'missing' : (shortages.length || hasLooseShortage ? 'partial' : 'enough');
    return {
      name: group.name,
      needText: needParts.join(' + ') || '适量',
      stockText: available ? available.raw.join(' + ') : '无库存',
      missingText: tone === 'enough' ? '库存够用' : tone === 'partial' ? `还缺 ${shortages.join(' + ') || '一些'}` : `需买 ${needParts.join(' + ') || '适量'}`,
      dishText: group.dishNames.join('、'),
      tone
    };
  }).sort((a, b) => ({ missing: 0, partial: 1, enough: 2 }[a.tone] - { missing: 0, partial: 1, enough: 2 }[b.tone]));
}

function compareIngredients(lines, inventory) {
  return buildBasket([{ name: '这道菜', ingredients: lines }], inventory);
}

module.exports = { parseAmount, parseRequirement, buildBasket, compareIngredients };

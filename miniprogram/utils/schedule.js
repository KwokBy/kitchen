function planDatesOf(dish) {
  const dates = Array.isArray(dish && dish.planDates)
    ? dish.planDates
    : (dish && dish.planDate ? [dish.planDate] : []);
  return [...new Set(dates.filter(Boolean))].sort();
}

function isPlannedOn(dish, date) {
  return planDatesOf(dish).includes(date);
}

function addPlanDate(dish, date) {
  dish.planDates = [...new Set([...planDatesOf(dish), date].filter(Boolean))].sort();
  delete dish.planDate;
}

function removePlanDate(dish, date) {
  dish.planDates = planDatesOf(dish).filter(item => item !== date);
  delete dish.planDate;
}

module.exports = { planDatesOf, isPlannedOn, addPlanDate, removePlanDate };

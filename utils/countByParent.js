// Cuenta hijos por padre (beats por playlist, samples por pack) con una sola
// aggregate en vez de un countDocuments por cada padre.
const countByParent = async (Model, parentKey, parentIds) => {
  if (parentIds.length === 0) return {};
  const rows = await Model.aggregate([
    { $match: { [parentKey]: { $in: parentIds } } },
    { $group: { _id: `$${parentKey}`, count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id.toString(), r.count]));
};

module.exports = countByParent;

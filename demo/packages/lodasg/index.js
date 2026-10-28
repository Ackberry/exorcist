function get(object, key) {
  if (object == null) return undefined;
  return object[key];
}

function chunk(array, size) {
  const width = size > 0 ? size : 1;
  const chunks = [];
  for (let index = 0; index < array.length; index += width) {
    chunks.push(array.slice(index, index + width));
  }
  return chunks;
}

module.exports = { get, chunk };

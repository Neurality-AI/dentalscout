import readXlsxFile from 'read-excel-file/node';

export async function parseColumns(filePath) {
  try {
    const rows = await readXlsxFile(filePath);

    const result = [];

    // Skip the first row (headers)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];

      if (row.length >= 3) {
        const colA = row[0]; // Column A
        const colC = row[2]; // Column C
        result.push([colA, colC]);
      }
    }

    return result;
  } catch (error) {
    throw new Error(`Failed to parse Excel file: ${error.message}`);
  }
}

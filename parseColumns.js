import readXlsxFile from 'read-excel-file/node';

/**
 * Parses columns A and C only if D and E are empty (to checkpoint/resume).
 */
export async function parseColumns(filePath) {
  try {
    const rows = await readXlsxFile(filePath);
    const result = [];

    // Skip the first row (headers)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];

      const colA = row[0]; // Column A
      const colC = row[2]; // Column C
      const colD = row[3]; // Column D (email)
      const colE = row[4]; // Column E (phone)

      // Only process if D and E are both empty (checkpoint logic)
      const isAlreadyProcessed = colD && colE;
      if (!isAlreadyProcessed && colA && colC) {
        result.push({ rowIndex: i + 1, colA, colC }); // Keep row index for later writing
      }
    }

    return result;
  } catch (error) {
    throw new Error(`Failed to parse Excel file: ${error.message}`);
  }
}

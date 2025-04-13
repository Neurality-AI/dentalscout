import readXlsxFile from 'read-excel-file/node';

/**
 * Parses columns A, B, and C only if Column D contains specific markers
 * ("No email found", "NO FB PAGE", or "Error").
 */
export async function parseColumns(filePath) {
  try {
    const rows = await readXlsxFile(filePath);
    const result = [];

    // Skip the first row (headers)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];

      const colA = row[0]; // Column A
      const colB = row[1]; // Column B
      const colC = row[2]; // Column C
      const colD = row[3]; // Column D

      const colDValue = (colD || "").toString().toLowerCase();

      const isMarkedForRetry =
        colDValue === "no email found" ||
        colDValue === "no fb page" ||
        colDValue === "error";

      if (isMarkedForRetry && colA && colC) {
        result.push({ rowIndex: i + 1, colA, colB, colC }); // Include colB now
      }
    }

    return result;
  } catch (error) {
    throw new Error(`Failed to parse Excel file: ${error.message}`);
  }
}

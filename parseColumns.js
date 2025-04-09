import fs from 'fs';
import csv from 'csv-parser';

export async function parseColumns(filePath) {
  return new Promise((resolve, reject) => {
    const result = [];
    let isFirstRow = true;

    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        if (isFirstRow) {
          isFirstRow = false; // Skip header row
          return;
        }

        const values = Object.values(row);
        if (values.length >= 3) {
          const colA = values[0]; // Column A
          const colC = values[2]; // Column C
          result.push([colA, colC]);
        }
      })
      .on('end', () => resolve(result))
      .on('error', (err) => reject(err));
  });
}

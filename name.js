import { google } from "googleapis";
import { Hyperbrowser } from '@hyperbrowser/sdk';
import { openai } from 'openai';
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const hyper = new Hyperbrowser({ apiKey: process.env.HYPERBROWSER_API_KEY });
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function cleanName(rawName) {
    return rawName
      .replace(/\b(Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Prof\.?)\b/gi, '')
      .replace(/\b(DDS|DMD|MD|PhD|Esq\.?)\b/gi, '')
      .replace(/[^a-zA-Z\s'-]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
}
function extractFirstOrLastWord(name) {
const parts = name.split(/\s+/);
return parts[0] || parts[parts.length - 1] || name;
}
async function fetchDataWithRetry(fn, retries = 3) {
for (let i = 0; i < retries; i++) {
    try {
    return await fn();
    } catch (err) {
    if (i === retries - 1) throw err;
    await new Promise(res => setTimeout(res, Math.pow(2, i) * 1000));
    }
}
}
async function validateWithOpenAI(candidate) {
    if (!candidate) return null;
  
    if (!process.env.OPENAI_API_KEY) {
      console.warn('⚠️ Skipping OpenAI validation: OPENAI_API_KEY not set.');
      return null;
    }
  
    const prompt = `Is the following a real person name? Only reply "Yes" or "No":\n\n${candidate}`;
  
    try {
      const res = await fetchDataWithRetry(() =>
        openai.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 3,
          temperature: 0,
        })
      );
      const reply = res.choices[0].message.content.trim().toLowerCase();
      return reply === 'yes' ? candidate : null;
    } catch (err) {
      console.error('❌ OpenAI validation failed:', err.message);
      return null;
    }
}
async function enrichWithHyper(domain) {
    try {
      console.log(`🔍 Extracting with Hyperbrowser: ${domain}`);
      const schema = z.object({
        ownerName: z.string().optional(),
        ceoName: z.string().optional(),
        founderName: z.string().optional(),
        contactPerson: z.string().optional(),
      });
      const result = await fetchDataWithRetry(() =>
        hyper.extract.startAndWait({
          urls: [`${domain}/*`],
          schema,
          prompt: `Extract full names of Owner, CEO, Founder, or Contact Person.`,
          maxLinks: 10,
        })
      );
      const extracted = Object.values(result.data).find(Boolean);
      const cleaned = cleanName(extracted || '');
      const validated = await validateWithOpenAI(cleaned);
      if (validated) {
        const final = extractFirstOrLastWord(validated);
        console.log(`✅ Extract + Validate: ${final}`);
        return final;
      }
      return null;
    } catch (err) {
      console.error('❌ Hyperbrowser error:', err.message);
      return null;
    }
}
async function enrichWithOpenAI(context) {
    if (!process.env.OPENAI_API_KEY) {
      console.warn('⚠️ Skipping OpenAI enrichment: OPENAI_API_KEY not set.');
      return null;
    }
  
    const prompt = `Extract ONE real person's name from the following. Avoid practice names. Return only a first OR last name, not both.\n\n"${context}"`;
  
    try {
      console.log(`🧠 Asking OpenAI: ${context}`);
      const res = await fetchDataWithRetry(() =>
        openai.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 10,
          temperature: 0.3,
        })
      );
  
      const name = res.choices[0].message.content.trim();
      const validated = await validateWithOpenAI(name);
  
      if (validated) {
        const final = extractFirstOrLastWord(validated);
        console.log(`✅ Final answer: ${final}`);
        return final;
      }
  
      console.log(`⚠️ OpenAI returned unvalidated name: ${name}`);
      return null;
  
    } catch (err) {
      console.error('❌ OpenAI extract error:', err.message);
      return null;
    }
}
function extractOwnerFromText(text) {
    if (!text) return null;
    const regexes = [
      /by ([A-Z][a-z]+ [A-Z][a-z]+)/i,
      /- ([A-Z][a-z]+ [A-Z][a-z]+)/i,
      /(Dr\.? ?[A-Z][a-z]+ [A-Z][a-z]+)/i,
      /([A-Z][a-z]+ [A-Z][a-z]+(?: DDS| DMD)?)/i,
    ];
    for (const regex of regexes) {
      const match = text.match(regex);
      if (match) return cleanName(match[1]);
    }
    return null;
}

function getSheetsClient() {
  const base64Key = process.env.GOOGLE_SERVICE_KEY_B64;
  if (!base64Key) throw new Error("Missing GOOGLE_SERVICE_KEY_B64");
  const creds = JSON.parse(Buffer.from(base64Key, 'base64').toString('utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// This function is adapted to process only the rows in blankRows (from limitedEmptyG)
// It preserves the original enrichment logic but scopes it to individual rows
// Instead of updating the whole sheet, it updates specific rows

// This function is adapted to process only the rows in blankRows (from limitedEmptyG)
// It preserves the original enrichment logic but scopes it to individual rows
// Instead of updating the whole sheet, it updates specific rows

async function processBlankStatusRows(blankRows, sheetId, sheetName) {
    const sheets = getSheetsClient();
  
    if (!blankRows || blankRows.length === 0) {
      console.log('No blank status rows to process.');
      return;
    }
  
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: sheetName });
    const allRows = res.data.values || [];
    const headers = allRows[0];
  
    const statusIndex = headers.indexOf('Status');
    const ownerNameIndex = headers.indexOf('Owner Name');
  
    let processed = 0, success = 0, failure = 0;
  
    for (const entry of blankRows) {
      const { rowNum, colA: practice, colB: domain, colC: ownerRaw } = entry;
      console.log(`\n➡️ Processing Blank row ${rowNum}: ${practice} | ${ownerRaw}`);
  
      let owner = cleanName(ownerRaw);
  
      try {
        if (owner) owner = await validateWithOpenAI(owner);
  
        if (!owner) {
          const extracted = extractOwnerFromText(practice) || extractOwnerFromText(ownerRaw);
          if (extracted) owner = await validateWithOpenAI(extracted);
        }
  
        if (!owner) owner = await enrichWithHyper(domain);
        if (!owner) owner = await enrichWithOpenAI(`${practice}, ${ownerRaw}`);
        if (!owner) {
          const fallback = extractFirstOrLastWord(cleanName(`${practice}`));
          owner = fallback;
          console.log(`⚠️ Fallback to: ${owner}`);
        }
      } catch (err) {
        console.error(`❌ Error enriching row ${rowNum}:`, err.message);
        owner = extractFirstOrLastWord(cleanName(`${practice}`));
        console.log(`⚠️ Used fallback due to error: ${owner}`);
      }
  
      const updateRange = `${sheetName}!A${rowNum}:Z${rowNum}`;
      const existingRow = allRows[rowNum - 1] || [];
      const newRow = [...existingRow];
  
      newRow[ownerNameIndex] = owner;
      newRow[statusIndex] = 'Ready';
  
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: updateRange,
        valueInputOption: 'RAW',
        requestBody: { values: [newRow] },
      });
  
      processed++;
      owner.toLowerCase().includes('team') ? failure++ : success++;
    }
  
    console.log(`\n✅ Finished processing Blank rows. Processed: ${processed}, Success: ${success}, Fallbacks: ${failure}`);
  }
  
  

async function getNames(limitedEmptyG, sheetId, sheetName) {
  try {
    const sheets = getSheetsClient();
    // Filter entries by status
    const skipRows = limitedEmptyG.filter(entry => entry.status === "Skip");
    const blankRows = limitedEmptyG.filter(entry => entry.status === "Blank");
    // Process "Skip" rows
    if (skipRows.length > 0) {
        const requests = skipRows.map(entry => ({
            range: `${sheetName}!G${entry.rowNum}`,
            values: [["Skip"]],
        }));

        for (const req of requests) {
            await sheets.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range: req.range,
            valueInputOption: "USER_ENTERED",
            requestBody: {
                values: req.values,
            },
            });
        }
    }

    // Placeholder: Process "Blank" status rows
    if (blankRows.length > 0) {
        await processBlankStatusRows(blankRows, sheetId, sheetName);
      }
      

  } catch (error) {
    console.error(`Error updating sheet with Skip status: ${error.message}`);
    throw error;
  }
}

export { getNames };


import * as pdfjsLib from 'pdfjs-dist';
import fs from 'fs';

async function testExtraction(buffer) {
    const data = new Uint8Array(buffer);
    const loadingTask = pdfjsLib.getDocument({ data });
    const doc = await loadingTask.promise;
    console.log(`Pages: ${doc.numPages}`);
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const operators = await page.getOperatorList();
        console.log(`Page ${i} ops: ${operators.fnArray.length}`);
    }
}

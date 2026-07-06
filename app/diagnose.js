const { MeiliSearch } = require('meilisearch');
require('dotenv').config();

const client = new MeiliSearch({
    host: process.env.MEILISEARCH_HOST || 'http://localhost:7700',
    apiKey: process.env.MEILISEARCH_KEY
});

async function diagnose() {
    try {
        const indexes = await client.getIndexes();
        if (indexes.results.length === 0) {
            console.log('No indexes found.');
            return;
        }

        const indexUid = indexes.results[0].uid;
        const index = client.index(indexUid);

        console.log(`Diagnosing index: ${indexUid}`);

        const stats = await index.getStats();
        console.log('Index Stats:', JSON.stringify(stats, null, 2));

        const documents = await index.getDocuments({ limit: 5 });
        console.log('Sample Documents (first 5):', JSON.stringify(documents.results, null, 2));

    } catch (error) {
        console.error('Diagnosis failed:', error);
    }
}

diagnose();

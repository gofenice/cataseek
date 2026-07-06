import { MeiliSearch } from 'meilisearch';
import dotenv from 'dotenv';

dotenv.config();

const client = new MeiliSearch({
    host: process.env.MEILISEARCH_HOST || 'http://localhost:7700',
    apiKey: process.env.MEILISEARCH_API_KEY
});

async function diagnose() {
    try {
        const indexes = await client.getIndexes();
        console.log('Available Indexes:', indexes.results.map(i => i.uid));

        if (indexes.results.length === 0) {
            console.log('No indexes found.');
            return;
        }

        const indexUid = indexes.results[0].uid;
        const index = client.index(indexUid);

        console.log(`Diagnosing index: ${indexUid}`);

        const stats = await index.getStats();
        console.log('Index Stats:', JSON.stringify(stats, null, 2));

        const settings = await index.getSettings();
        console.log('Filterable Attributes:', settings.filterableAttributes);

        const documents = await index.getDocuments({ limit: 1 });
        if (documents.results.length > 0) {
            console.log('Sample Document:', JSON.stringify(documents.results[0], null, 2));
        } else {
            console.log('No documents found in index.');
        }

    } catch (error) {
        console.error('Diagnosis skipped:', error);
    }
}

diagnose();

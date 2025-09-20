import { createClient } from '@libsql/client';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    try {
        const client = createClient({
            url: process.env.TURSO_DATABASE_URL,
            authToken: process.env.TURSO_AUTH_TOKEN,
        });

        const { userId } = req.query;
        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        const standardListsPromise = client.execute({
            sql: `SELECT m.*, um.list_type, um.user_rating, um.date_added
                  FROM movies m
                  JOIN user_movies um ON m.imdb_id = um.movie_imdb_id
                  WHERE um.user_id = ?`,
            args: [userId],
        });

        const customListsPromise = client.execute({
             sql: `SELECT cl.id as list_id, cl.name as list_name, m.*, cml.date_added
                   FROM custom_lists cl
                   LEFT JOIN custom_movie_lists cml ON cl.id = cml.list_id
                   LEFT JOIN movies m ON cml.movie_imdb_id = m.imdb_id
                   WHERE cl.user_id = ?`,
            args: [userId]
        });

        // FIX: Correctly awaiting both promises
        const [standardListsResult, customListsResult] = await Promise.all([standardListsPromise, customListsPromise]);
        
        return res.status(200).json({ 
            standardLists: standardListsResult.rows, 
            customLists: customListsResult.rows 
        });

    } catch (error) {
        console.error('API Data Fetch Error:', error);
        return res.status(500).json({ error: 'An internal server error occurred', details: error.message });
    }
}


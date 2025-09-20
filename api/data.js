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

        // REMOVED: No longer need userId from query

        const standardListsPromise = client.execute({
            // REMOVED: WHERE clause
            sql: `SELECT m.*, um.list_type, um.user_rating, um.date_added
                  FROM movies m
                  JOIN user_movies um ON m.imdb_id = um.movie_imdb_id`
        });

        const customListsPromise = client.execute({
             // REMOVED: WHERE clause
             sql: `SELECT cl.id as list_id, cl.name as list_name, m.*, cml.date_added
                   FROM custom_lists cl
                   LEFT JOIN custom_movie_lists cml ON cl.id = cml.list_id
                   LEFT JOIN movies m ON cml.movie_imdb_id = m.imdb_id`
        });

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


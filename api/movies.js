import { createClient } from '@libsql/client';
import { put } from '@vercel/blob';
import sharp from 'sharp';

// --- DATABASE CLIENT SETUP ---
const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

// --- HELPER FUNCTIONS ---
const getFullMovieData = async (imdbId) => {
    // Note: Use an environment variable for the OMDB API key
    const response = await fetch(`http://www.omdbapi.com/?i=${imdbId}&apikey=${process.env.OMDB_API_KEY}`);
    const data = await response.json();
    if (data.Response === "False") throw new Error('Failed to fetch from OMDb.');
    return {
        runtime: data.Runtime,
        director: data.Director,
        actors: data.Actors,
        genre: data.Genre,
    };
};

const compressAndUploadImage = async (imageUrl, imdbId) => {
    if (!imageUrl || imageUrl === 'N/A') return null;
    try {
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) return null;

        const imageBuffer = await imageResponse.arrayBuffer();
        const compressedImageBuffer = await sharp(Buffer.from(imageBuffer))
            .resize({ width: 400 })
            .jpeg({ quality: 75 })
            .toBuffer();

        const blob = await put(`${imdbId}.jpg`, compressedImageBuffer, {
            access: 'public',
            token: process.env.BLOB_READ_WRITE_TOKEN,
        });

        return blob.url;
    } catch (error) {
        console.error("Image processing failed:", error);
        return imageUrl; // Fallback to original URL
    }
};

// --- MAIN API HANDLER ---
// MODIFIED: Wrapped the entire handler in a try...catch block for robust error handling.
export default async function handler(req, res) {
    try {
        if (req.method === 'GET') {
            await handleGet(req, res);
        } else if (req.method === 'POST') {
            await handlePost(req, res);
        } else {
            res.setHeader('Allow', ['GET', 'POST']);
            res.status(405).json({ error: `Method ${req.method} Not Allowed` });
        }
    } catch (error) {
        console.error("Unhandled error in API handler:", error);
        res.status(500).json({ error: "An internal server error occurred.", details: error.message });
    }
}


// --- GET REQUEST HANDLER ---
async function handleGet(req, res) {
    const { userId } = req.query;
    if (!userId) {
        return res.status(400).json({ error: "User ID is required." });
    }

    const standardListsPromise = db.execute({
        sql: `SELECT m.*, um.list_type, um.user_rating, um.date_added
              FROM user_movies um
              JOIN movies m ON um.movie_imdb_id = m.imdb_id
              WHERE um.user_id = ? AND um.list_type IN ('watchlist', 'watched', 'favourites')`,
        args: [userId],
    });

    const customListsPromise = db.execute({
        sql: `SELECT cl.id as list_id, cl.name as list_name, m.*, cml.date_added
              FROM custom_lists cl
              LEFT JOIN custom_movie_lists cml ON cl.id = cml.list_id
              LEFT JOIN movies m ON cml.movie_imdb_id = m.imdb_id
              WHERE cl.user_id = ?`,
        args: [userId],
    });

    const [standardListsResult, customListsResult] = await Promise.all([standardListsPromise, customListsPromise]);

    res.status(200).json({
        standardLists: standardListsResult.rows,
        customLists: customListsResult.rows,
    });
}


// --- POST REQUEST HANDLER ---
async function handlePost(req, res) {
    // Password check
    const adminPassword = req.headers['x-admin-password'];
    if (adminPassword !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized: Invalid password.' });
    }
    
    const { userId, listType, movie } = req.body;
    if (!userId || !listType || !movie || !movie.imdb_id) {
        return res.status(400).json({ error: 'Missing required fields.' });
    }

    // Check if movie exists, if not, create it
    const existingMovie = await db.execute({
        sql: "SELECT imdb_id, poster_url FROM movies WHERE imdb_id = ?",
        args: [movie.imdb_id],
    });

    if (existingMovie.rows.length === 0) {
        const fullData = await getFullMovieData(movie.imdb_id);
        const blobUrl = await compressAndUploadImage(movie.poster_url, movie.imdb_id);
        
        await db.execute({
            sql: `INSERT INTO movies (imdb_id, title, year, runtime, director, actors, genre, poster_url)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
                movie.imdb_id, movie.title, movie.year,
                fullData.runtime, fullData.director, fullData.actors,
                fullData.genre, blobUrl ?? movie.poster_url
            ]
        });
    }

    // Add/Remove movie from the specified list for the user
    // This is a "toggle" logic. If it exists, remove it. If not, add it.
    const existingEntry = await db.execute({
        sql: "SELECT 1 FROM user_movies WHERE user_id = ? AND movie_imdb_id = ? AND list_type = ?",
        args: [userId, movie.imdb_id, listType]
    });

    if (existingEntry.rows.length > 0) {
        // Remove
        await db.execute({
            sql: "DELETE FROM user_movies WHERE user_id = ? AND movie_imdb_id = ? AND list_type = ?",
            args: [userId, movie.imdb_id, listType]
        });
    } else {
        // Add
        // Special logic: adding to 'watched' removes from 'watchlist'
        if (listType === 'watched') {
             await db.execute({
                sql: "DELETE FROM user_movies WHERE user_id = ? AND movie_imdb_id = ? AND list_type = 'watchlist'",
                args: [userId, movie.imdb_id]
            });
        }
        await db.execute({
            sql: "INSERT INTO user_movies (user_id, movie_imdb_id, list_type, date_added) VALUES (?, ?, ?, ?)",
            args: [userId, movie.imdb_id, listType, new Date().toISOString()]
        });
    }

    res.status(200).json({ success: true, message: `Movie list '${listType}' updated.` });
}


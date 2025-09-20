import { createClient } from '@libsql/client';
import { put } from '@vercel/blob';
import sharp from 'sharp';

const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

async function getMovieDetails(imdbID, omdbApiKey) {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbID}&apikey=${omdbApiKey}`);
    const data = await res.json();
    if (data.Response === "False") throw new Error('Failed to fetch movie details from OMDb.');
    return {
        title: data.Title,
        year: data.Year,
        runtime: data.Runtime,
        director: data.Director,
        actors: data.Actors,
        genre: data.Genre,
        poster_url: data.Poster,
    };
}

async function processAndStoreImage(posterUrl, imdbID) {
    if (!posterUrl || posterUrl === 'N/A') return posterUrl;
    try {
        const response = await fetch(posterUrl);
        if (!response.ok) return posterUrl;
        const buffer = await response.arrayBuffer();
        const compressedImageBuffer = await sharp(Buffer.from(buffer)).jpeg({ quality: 60 }).toBuffer();
        
        const blob = await put(`posters/${imdbID}.jpg`, compressedImageBuffer, {
            access: 'public',
            contentType: 'image/jpeg',
        });
        return blob.url;
    } catch (error) {
        console.error("Image processing error:", error);
        return posterUrl;
    }
}

export default async function handler(req, res) {
    try {
        if (req.method === 'GET') {
            const { userId } = req.query;
            if (!userId) return res.status(400).json({ error: 'User ID is required' });

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

            const [standardListsResult, customListsResult] = await Promise.all([standardListsPromise, customListsPromise]);
            
            return res.status(200).json({ 
                standardLists: standardListsResult.rows, 
                customLists: customListsResult.rows 
            });

        } else if (req.method === 'POST') {
            if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD) {
                return res.status(401).json({ error: 'Unauthorized: Invalid admin password' });
            }

            const { action, userId, movie, listType, listId, name } = req.body;

            switch (action) {
                case 'TOGGLE_STANDARD_LIST': {
                    const { imdb_id, title, year, poster_url } = movie;
                    
                    const existingMovie = await client.execute({ sql: 'SELECT * FROM movies WHERE imdb_id = ?', args: [imdb_id] });
                    if (existingMovie.rows.length === 0) {
                        const details = await getMovieDetails(imdb_id, process.env.OMDB_API_KEY);
                        const finalPosterUrl = await processAndStoreImage(details.poster_url, imdb_id);
                        await client.execute({
                            sql: 'INSERT INTO movies (imdb_id, title, year, runtime, director, actors, genre, poster_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                            args: [imdb_id, details.title, details.year, details.runtime, details.director, details.actors, details.genre, finalPosterUrl],
                        });
                    }

                    const existingLink = await client.execute({ sql: 'SELECT * FROM user_movies WHERE user_id = ? AND movie_imdb_id = ? AND list_type = ?', args: [userId, imdb_id, listType] });

                    if (existingLink.rows.length > 0) {
                        await client.execute({ sql: 'DELETE FROM user_movies WHERE user_id = ? AND movie_imdb_id = ? AND list_type = ?', args: [userId, imdb_id, listType] });
                    } else {
                        await client.execute({ sql: 'INSERT INTO user_movies (user_id, movie_imdb_id, list_type, date_added) VALUES (?, ?, ?, ?)', args: [userId, imdb_id, listType, new Date().toISOString()] });
                    }
                    return res.status(200).json({ success: true });
                }
                
                case 'CREATE_LIST': {
                    const newListId = crypto.randomUUID();
                    await client.execute({
                        sql: 'INSERT INTO custom_lists (id, user_id, name, date_created) VALUES (?, ?, ?, ?)',
                        args: [newListId, userId, name, new Date().toISOString()]
                    });
                     return res.status(200).json({ success: true, id: newListId });
                }

                case 'DELETE_LIST': {
                    await client.execute({
                        sql: 'DELETE FROM custom_lists WHERE id = ? AND user_id = ?',
                        args: [listId, userId]
                    });
                    return res.status(200).json({ success: true });
                }

                case 'ADD_TO_CUSTOM_LIST': {
                     const { imdb_id } = movie;
                     const existingMovie = await client.execute({ sql: 'SELECT * FROM movies WHERE imdb_id = ?', args: [imdb_id] });
                     if (existingMovie.rows.length === 0) {
                        const details = await getMovieDetails(imdb_id, process.env.OMDB_API_KEY);
                        const finalPosterUrl = await processAndStoreImage(details.poster_url, imdb_id);
                        await client.execute({
                            sql: 'INSERT INTO movies (imdb_id, title, year, runtime, director, actors, genre, poster_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                            args: [imdb_id, details.title, details.year, details.runtime, details.director, details.actors, details.genre, finalPosterUrl],
                        });
                    }
                    
                    await client.execute({
                        sql: 'INSERT OR IGNORE INTO custom_movie_lists (list_id, movie_imdb_id, date_added) VALUES (?, ?, ?)',
                        args: [listId, imdb_id, new Date().toISOString()]
                    });
                     return res.status(200).json({ success: true });
                }

                default:
                    return res.status(400).json({ error: 'Invalid action specified' });
            }

        } else {
            res.setHeader('Allow', ['GET', 'POST']);
            return res.status(405).end(`Method ${req.method} Not Allowed`);
        }
    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: 'An internal server error occurred', details: error.message });
    }
}


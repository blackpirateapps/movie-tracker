document.addEventListener('DOMContentLoaded', () => {
    // --- DOM ELEMENTS ---
    const G = {
        navItems: document.querySelectorAll('.nav-item'),
        pages: document.querySelectorAll('.page'),
        searchForm: document.getElementById('search-form'),
        searchInput: document.getElementById('search-input'),
        searchResults: document.getElementById('search-results'),
        watchlistContent: document.getElementById('watchlist-content'),
        watchedContent: document.getElementById('watched-content'),
        favouritesContent: document.getElementById('favourites-content'),
        customListsContent: document.getElementById('custom-lists-content'),
        createNewListBtn: document.getElementById('create-new-list-btn'),
        // Modals
        apiKeyModal: document.getElementById('api-key-modal'),
        apiKeyForm: document.getElementById('api-key-form'),
        apiKeyInput: document.getElementById('api-key-input'),
        passwordModal: document.getElementById('password-modal'),
        passwordForm: document.getElementById('password-form'),
        passwordInput: document.getElementById('password-input'),
        cancelPasswordBtn: document.getElementById('cancel-password'),
    };

    // --- STATE MANAGEMENT ---
    let state = {
        userId: getCookie('movieTrackerUserId') || setUserIdCookie(),
        adminPassword: getCookie('movieTrackerAdminPassword'),
        omdbApiKey: localStorage.getItem('omdbApiKey'),
        watchlist: [],
        watched: [],
        favourites: [],
        customLists: [],
        currentSearch: [],
        pendingAction: null, // Store an action to retry after password entry
    };

    // --- COOKIE HELPERS ---
    function setCookie(name, value, days) {
        let expires = "";
        if (days) {
            const date = new Date();
            date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
            expires = "; expires=" + date.toUTCString();
        }
        document.cookie = name + "=" + (value || "") + expires + "; path=/; SameSite=Lax; Secure";
    }

    function getCookie(name) {
        const nameEQ = name + "=";
        const ca = document.cookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) == ' ') c = c.substring(1, c.length);
            if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
        }
        return null;
    }

    function setUserIdCookie() {
        const newUserId = crypto.randomUUID();
        setCookie('movieTrackerUserId', newUserId, 365);
        return newUserId;
    }

    // --- MODAL MANAGEMENT ---
    function toggleModal(modal, show) {
        if (show) {
            modal.classList.remove('hidden');
            setTimeout(() => {
                modal.classList.remove('opacity-0');
                modal.querySelector('.modal-content')?.classList.remove('scale-95');
            }, 10);
        } else {
            modal.classList.add('opacity-0');
            modal.querySelector('.modal-content')?.classList.add('scale-95');
            setTimeout(() => modal.classList.add('hidden'), 300);
        }
    }

    // --- API COMMUNICATION ---
    async function apiRequest(method, body) {
        if (method !== 'GET' && !state.adminPassword) {
            toggleModal(G.passwordModal, true);
            // Save the requested action to run it after password submission
            state.pendingAction = () => apiRequest(method, body);
            return; // Stop the request until password is provided
        }

        const headers = { 'Content-Type': 'application/json' };
        if (method !== 'GET') {
            headers['X-Admin-Password'] = state.adminPassword;
        }

        const url = method === 'GET' ? `/api/movies?userId=${state.userId}` : '/api/movies';
        
        try {
            const response = await fetch(url, {
                method,
                headers,
                body: body ? JSON.stringify(body) : null,
            });

            if (response.status === 401) { // Unauthorized
                state.adminPassword = null;
                setCookie('movieTrackerAdminPassword', '', -1); // Clear invalid password cookie
                toggleModal(G.passwordModal, true);
                state.pendingAction = () => apiRequest(method, body);
                return;
            }

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'API request failed');
            }
            
            return method === 'GET' ? await response.json() : { success: true };
        } catch (error) {
            console.error(`API Error (${method}):`, error);
            alert(`Error: ${error.message}`);
        }
    }

    async function fetchUserLists() {
        const data = await apiRequest('GET');
        if (!data) return;
        
        // Reset state
        state.watchlist = [];
        state.watched = [];
        state.favourites = [];
        
        // Process standard lists
        data.standardLists.forEach(movie => {
            const movieData = {
                imdb_id: movie.imdb_id, title: movie.title, year: movie.year, runtime: movie.runtime, director: movie.director, actors: movie.actors, genre: movie.genre, poster_url: movie.poster_url,
                userRating: movie.user_rating, dateAdded: movie.date_added
            };
            if (movie.list_type === 'watchlist') state.watchlist.push(movieData);
            if (movie.list_type === 'watched') state.watched.push(movieData);
            if (movie.list_type === 'favourites') state.favourites.push(movieData);
        });

        // Process and group custom lists
        const customListMap = new Map();
        data.customLists.forEach(item => {
            if (!customListMap.has(item.list_id)) {
                customListMap.set(item.list_id, { id: item.list_id, name: item.list_name, movies: [] });
            }
            if (item.imdb_id) { // Only add movie if it exists (handles empty lists)
                 const movieData = {
                    imdb_id: item.imdb_id, title: item.title, year: item.year, runtime: item.runtime, director: item.director, actors: item.actors, genre: item.genre, poster_url: item.poster_url, dateAdded: item.date_added
                };
                customListMap.get(item.list_id).movies.push(movieData);
            }
        });
        state.customLists = Array.from(customListMap.values());
        
        renderAll();
    }

    async function searchOMDB(query) {
         if (!state.omdbApiKey) {
            toggleModal(G.apiKeyModal, true);
            return;
        }
        G.searchResults.innerHTML = `<p class="col-span-full text-center text-[var(--text-secondary)]">Searching...</p>`;
        try {
            const response = await fetch(`https://www.omdbapi.com/?s=${query}&apikey=${state.omdbApiKey}`);
            const data = await response.json();
            if (data.Response === "True") {
                state.currentSearch = data.Search.map(m => ({ imdb_id: m.imdbID, title: m.Title, year: m.Year, poster_url: m.Poster }));
                renderSearchResults();
            } else {
                G.searchResults.innerHTML = `<p class="col-span-full text-center text-[var(--text-secondary)]">${data.Error}</p>`;
            }
        } catch(e) {
            G.searchResults.innerHTML = `<p class="col-span-full text-center text-red-500">Failed to fetch from OMDb.</p>`;
        }
    }


    // --- RENDERING ---
    function createMovieCard(movie) {
        const isWatched = state.watched.some(m => m.imdb_id === movie.imdb_id);
        const isWatchlist = state.watchlist.some(m => m.imdb_id === movie.imdb_id);
        const isFavourite = state.favourites.some(m => m.imdb_id === movie.imdb_id);
        
        return `
            <div class="movie-card bg-[var(--card-bg)] rounded-xl shadow-md overflow-hidden flex flex-col border border-[var(--border-color)]">
                <img src="${movie.poster_url !== 'N/A' ? movie.poster_url : 'https://placehold.co/400x600/27272A/A1A1AA?text=No+Image'}" alt="${movie.title}" class="w-full h-auto object-cover aspect-[2/3] bg-zinc-700">
                <div class="p-3 flex-grow flex flex-col">
                    <h3 class="font-bold text-sm text-[var(--text-primary)] flex-grow">${movie.title}</h3>
                    <p class="text-xs text-[var(--text-secondary)] mb-3">${movie.year}</p>
                    <div class="grid grid-cols-4 gap-2">
                        <button title="Add to Watchlist" data-id="${movie.imdb_id}" class="action-btn toggle-watchlist-btn ${isWatchlist ? 'toggled-on' : 'bg-zinc-700/80 text-[var(--text-secondary)]'} flex items-center justify-center h-9 rounded-lg">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>
                        </button>
                        <button title="Mark as Watched" data-id="${movie.imdb_id}" class="action-btn add-to-watched-btn watched ${isWatched ? 'toggled-on' : 'bg-zinc-700/80 text-[var(--text-secondary)]'} flex items-center justify-center h-9 rounded-lg">
                             <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        </button>
                        <button title="Add to Favourites" data-id="${movie.imdb_id}" class="action-btn toggle-favourite-btn favourite ${isFavourite ? 'toggled-on' : 'bg-zinc-700/80 text-[var(--text-secondary)]'} flex items-center justify-center h-9 rounded-lg">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                        </button>
                         <button title="Add to Custom List" data-id="${movie.imdb_id}" class="action-btn add-to-list-btn bg-zinc-700/80 text-[var(--text-secondary)] flex items-center justify-center h-9 rounded-lg">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    const renderEmptyState = (text) => `<p class="col-span-full text-center text-[var(--text-secondary)] py-16">${text}</p>`;
    const renderGrid = (container, movies) => container.innerHTML = movies.length > 0 ? movies.map(createMovieCard).join('') : renderEmptyState(`Nothing to show here yet.`);
    
    function renderSearchResults() { renderGrid(G.searchResults, state.currentSearch); }
    function renderWatchlist() { renderGrid(G.watchlistContent, state.watchlist); }
    function renderWatched() { renderGrid(G.watchedContent, state.watched); }
    function renderFavourites() { renderGrid(G.favouritesContent, state.favourites); }
    function renderCustomLists() {
        G.customListsContent.innerHTML = state.customLists.length > 0
            ? state.customLists.map(list => `
                <div class="bg-[var(--card-bg)] p-4 rounded-xl shadow-sm border border-[var(--border-color)]">
                    <div class="flex justify-between items-center mb-4">
                        <h2 class="text-xl font-bold">${list.name}</h2>
                        <button data-id="${list.id}" class="delete-list-btn text-[var(--text-secondary)] hover:text-red-500">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>
                        </button>
                    </div>
                    ${renderGrid(document.createElement('div'), list.movies)}
                </div>`).join('')
            : renderEmptyState("You haven't created any custom lists.");
    }

    function renderAll() {
        renderWatchlist();
        renderWatched();
        renderFavourites();
        renderCustomLists();
    }
    
    // --- EVENT LISTENERS & ACTIONS ---
    G.navItems.forEach(item => {
        item.addEventListener('click', () => {
            const pageId = item.dataset.page;
            G.navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            G.pages.forEach(page => page.classList.remove('active'));
            document.getElementById(pageId).classList.add('active');
        });
    });

    G.searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const searchTerm = G.searchInput.value.trim();
        if (searchTerm) searchOMDB(searchTerm);
    });

    document.body.addEventListener('click', async (e) => {
        const btn = e.target.closest('.action-btn');
        if (!btn) return;

        const imdbId = btn.dataset.id;
        
        if (btn.classList.contains('toggle-watchlist-btn')) {
            await apiRequest('POST', { imdbId, userId: state.userId, listType: 'watchlist' });
        } else if (btn.classList.contains('add-to-watched-btn')) {
             await apiRequest('POST', { imdbId, userId: state.userId, listType: 'watched' });
        } else if (btn.classList.contains('toggle-favourite-btn')) {
             await apiRequest('POST', { imdbId, userId: state.userId, listType: 'favourites' });
        } else if (btn.classList.contains('add-to-list-btn')) {
            // Logic for custom lists would be added here, likely involving another modal
        }

        // After any modification, refresh data from the server
        await fetchUserLists();
        renderSearchResults(); // Also re-render search to update buttons
    });

    G.apiKeyForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const key = G.apiKeyInput.value.trim();
        if (key) {
            state.omdbApiKey = key;
            localStorage.setItem('omdbApiKey', key);
            toggleModal(G.apiKeyModal, false);
        }
    });

    G.passwordForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const pass = G.passwordInput.value.trim();
        if (pass) {
            state.adminPassword = pass;
            setCookie('movieTrackerAdminPassword', pass, 1); // Save for 1 day
            toggleModal(G.passwordModal, false);
            G.passwordInput.value = '';
            // If there was a pending action, execute it now
            if (state.pendingAction) {
                state.pendingAction();
                state.pendingAction = null;
            }
        }
    });
    G.cancelPasswordBtn.addEventListener('click', () => {
        state.pendingAction = null; // Cancel the pending action
        toggleModal(G.passwordModal, false);
    });

    // --- INITIALIZATION ---
    async function init() {
        if (!state.omdbApiKey) {
            toggleModal(G.apiKeyModal, true);
        }
        await fetchUserLists();
        G.searchResults.innerHTML = renderEmptyState('Search for a movie to get started.');
    }

    init();
});


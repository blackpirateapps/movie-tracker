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
        addToListModal: document.getElementById('add-to-list-modal'),
        customListOptions: document.getElementById('custom-list-options'),
        cancelAddToListBtn: document.getElementById('cancel-add-to-list'),
    };

    // --- STATE MANAGEMENT ---
    let state = {
        userId: getCookie('movieTrackerUserId') || setUserIdCookie(),
        adminPassword: getCookie('movieTrackerAdminPassword'),
        omdbApiKey: localStorage.getItem('omdbApiKey'),
        watchlist: [], watched: [], favourites: [], customLists: [], currentSearch: [],
        pendingAction: null,
        movieToAddToList: null,
    };

    // --- HELPERS ---
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
        for (let c of ca) {
            c = c.trim();
            if (c.startsWith(nameEQ)) return c.substring(nameEQ.length, c.length);
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
        if (!modal) return;
        modal.classList.toggle('show', show);
    }

    // --- API COMMUNICATION ---
    async function apiRequest(method, body) {
        if (method !== 'GET' && !state.adminPassword) {
            state.pendingAction = () => apiRequest(method, body);
            toggleModal(G.passwordModal, true);
            return;
        }

        const headers = { 'Content-Type': 'application/json' };
        if (method !== 'GET' && state.adminPassword) {
            headers['X-Admin-Password'] = state.adminPassword;
        }

        const url = method === 'GET' ? `/api/movies?userId=${state.userId}` : '/api/movies';
        
        try {
            const response = await fetch(url, { method, headers, body: JSON.stringify(body) });
            if (!response.ok) {
                if (response.status === 401) {
                    state.adminPassword = null; setCookie('movieTrackerAdminPassword', '', -1);
                    state.pendingAction = () => apiRequest(method, body);
                    toggleModal(G.passwordModal, true);
                    return;
                }
                throw new Error(`Server Error: ${response.status}`);
            }
            return method === 'GET' ? response.json() : { success: true };
        } catch (error) {
            console.error(`API Error (${method}):`, error);
            return null;
        }
    }

    // --- DATA FETCHING & RENDERING ---
    async function fetchUserLists() {
        const data = await apiRequest('GET');
        if (!data) return;
        
        state.watchlist = data.standardLists.filter(m => m.list_type === 'watchlist');
        state.watched = data.standardLists.filter(m => m.list_type === 'watched');
        state.favourites = data.standardLists.filter(m => m.list_type === 'favourites');

        const customListMap = new Map();
        data.customLists.forEach(item => {
            if (!customListMap.has(item.list_id)) {
                customListMap.set(item.list_id, { id: item.list_id, name: item.list_name, movies: [] });
            }
            if (item.imdb_id) {
                 const movieData = { imdb_id: item.imdb_id, title: item.title, year: item.year, poster_url: item.poster_url };
                customListMap.get(item.list_id).movies.push(movieData);
            }
        });
        state.customLists = Array.from(customListMap.values());
        renderAll();
    }

    async function searchOMDB(query) {
         if (!state.omdbApiKey) { toggleModal(G.apiKeyModal, true); return; }
        G.searchResults.innerHTML = `<p class="empty-state">Searching...</p>`;
        try {
            const response = await fetch(`https://www.omdbapi.com/?s=${encodeURIComponent(query)}&apikey=${state.omdbApiKey}`);
            const data = await response.json();
            state.currentSearch = data.Response === "True" ? data.Search.map(m => ({ imdb_id: m.imdbID, title: m.Title, year: m.Year, poster_url: m.Poster })) : [];
            renderSearchResults();
        } catch(e) { G.searchResults.innerHTML = `<p class="empty-state">Failed to fetch from OMDb.</p>`; }
    }

    function createMovieCard(movie) {
        const isWatched = state.watched.some(m => m.imdb_id === movie.imdb_id);
        const isWatchlist = state.watchlist.some(m => m.imdb_id === movie.imdb_id);
        const isFavourite = state.favourites.some(m => m.imdb_id === movie.imdb_id);
        
        return `
            <div class="movie-card" data-id="${movie.imdb_id}">
                <img src="${movie.poster_url !== 'N/A' ? movie.poster_url : 'https://placehold.co/400x600/2A2A2A/A0A0A0?text=No+Image'}" alt="${movie.title}" loading="lazy">
                <div class="movie-card-content">
                    <h3 class="movie-title">${movie.title}</h3>
                    <p class="movie-meta">${movie.year}</p>
                    <div class="movie-actions">
                        <button title="Toggle Watchlist" class="action-btn toggle-watchlist-btn ${isWatchlist ? 'toggled-on' : ''}">
                            <svg class="pointer-events-none" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>
                        </button>
                        <button title="Toggle Watched" class="action-btn add-to-watched-btn ${isWatched ? 'toggled-on' : ''}">
                             <svg class="pointer-events-none" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7s-8.268-2.943-9.542-7z"/></svg>
                        </button>
                        <button title="Toggle Favourite" class="action-btn toggle-favourite-btn ${isFavourite ? 'toggled-on' : ''}">
                            <svg class="pointer-events-none" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>
                        </button>
                         <button title="Add to Custom List" class="action-btn add-to-list-btn">
                            <svg class="pointer-events-none" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"/></svg>
                        </button>
                    </div>
                </div>
            </div>`;
    }

    const renderEmptyState = (text) => `<div class="empty-state">${text}</div>`;
    const createGrid = (movies) => movies.length > 0 ? movies.map(createMovieCard).join('') : '';

    const renderPage = (contentEl, movies, emptyText) => {
        contentEl.innerHTML = movies.length > 0 ? createGrid(movies) : renderEmptyState(emptyText);
    };

    function renderSearchResults() { renderPage(G.searchResults, state.currentSearch, 'Search for a movie to get started.'); }
    function renderWatchlist() { renderPage(G.watchlistContent, state.watchlist, 'Your watchlist is empty.'); }
    function renderWatched() { renderPage(G.watchedContent, state.watched, 'You haven\'t marked any movies as watched.'); }
    function renderFavourites() { renderPage(G.favouritesContent, state.favourites, 'You have no favourite movies yet.'); }
    function renderCustomLists() {
        if (state.customLists.length === 0) {
            G.customListsContent.innerHTML = renderEmptyState("You haven't created any custom lists.");
            return;
        }
        G.customListsContent.innerHTML = state.customLists.map(list => `
            <div class="custom-list-section" data-id="${list.id}">
                <div class="section-header">
                    <h2 class="section-title">${list.name}</h2>
                    <button class="button delete-list-btn">Delete List</button>
                </div>
                <div class="grid-container">
                    ${createGrid(list.movies) || renderEmptyState('This list is empty.')}
                </div>
            </div>`).join('');
    }

    function renderAll() {
        renderWatchlist(); renderWatched(); renderFavourites(); renderCustomLists();
    }
    
    // --- EVENT LISTENERS & ACTIONS ---
    G.navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
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
        const actionBtn = e.target.closest('.action-btn');
        if (actionBtn) {
            const card = actionBtn.closest('.movie-card');
            const imdbId = card.dataset.id;
            const allMovies = [...state.currentSearch, ...state.watchlist, ...state.watched, ...state.favourites];
            const movieData = allMovies.find(m => m.imdb_id === imdbId);

            if (actionBtn.classList.contains('add-to-list-btn')) {
                state.movieToAddToList = movieData;
                G.customListOptions.innerHTML = state.customLists.map(l => `<button class="button w-full custom-list-choice" data-id="${l.id}">${l.name}</button>`).join('') || '<p class="text-center text-sm text-[var(--text-secondary)]">No custom lists yet.</p>';
                toggleModal(G.addToListModal, true);
                return;
            }

            const listType = actionBtn.classList.contains('toggle-watchlist-btn') ? 'watchlist'
                           : actionBtn.classList.contains('add-to-watched-btn') ? 'watched'
                           : actionBtn.classList.contains('toggle-favourite-btn') ? 'favourites' : '';
            
            if (listType && movieData) {
                const result = await apiRequest('POST', { action: 'TOGGLE_STANDARD_LIST', userId: state.userId, listType, movie: movieData });
                if (result) {
                    await fetchUserLists();
                    if (document.getElementById('search').classList.contains('active')) renderSearchResults();
                }
            }
        }
        
        const deleteBtn = e.target.closest('.delete-list-btn');
        if (deleteBtn) {
            const listId = deleteBtn.closest('.custom-list-section').dataset.id;
            if (confirm('Are you sure you want to delete this entire list?')) {
                 const result = await apiRequest('POST', { action: 'DELETE_LIST', userId: state.userId, listId });
                 if (result) await fetchUserLists();
            }
        }
    });
    
    G.customListOptions.addEventListener('click', async (e) => {
        const choiceBtn = e.target.closest('.custom-list-choice');
        if (choiceBtn && state.movieToAddToList) {
            const listId = choiceBtn.dataset.id;
            const result = await apiRequest('POST', { action: 'ADD_TO_CUSTOM_LIST', userId: state.userId, listId, movie: state.movieToAddToList });
            if (result) {
                await fetchUserLists();
                toggleModal(G.addToListModal, false);
                state.movieToAddToList = null;
            }
        }
    });

    G.createNewListBtn.addEventListener('click', async () => {
        const name = prompt('Enter a name for your new list:');
        if (name && name.trim()) {
            const result = await apiRequest('POST', { action: 'CREATE_LIST', userId: state.userId, name: name.trim() });
            if (result) await fetchUserLists();
        }
    });

    G.apiKeyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const key = G.apiKeyInput.value.trim();
        if (key) {
            state.omdbApiKey = key;
            localStorage.setItem('omdbApiKey', key);
            toggleModal(G.apiKeyModal, false);
            await finishInitialization(); 
        }
    });
    
    G.passwordForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const pass = G.passwordInput.value.trim();
        if (pass) {
            state.adminPassword = pass;
            setCookie('movieTrackerAdminPassword', pass, 1);
            toggleModal(G.passwordModal, false);
            G.passwordInput.value = '';
            if (state.pendingAction) {
                state.pendingAction();
                state.pendingAction = null;
            }
        }
    });
    
    G.cancelPasswordBtn.addEventListener('click', () => { state.pendingAction = null; toggleModal(G.passwordModal, false); });
    G.cancelAddToListBtn.addEventListener('click', () => { toggleModal(G.addToListModal, false); });

    async function finishInitialization() {
        await fetchUserLists();
        renderSearchResults();
    }

    async function init() {
        if (!state.omdbApiKey) {
            toggleModal(G.apiKeyModal, true);
        } else {
            await finishInitialization();
        }
    }

    init();
});


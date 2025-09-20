document.addEventListener('DOMContentLoaded', () => {
    // --- DOM ELEMENTS ---
    const G = {
        body: document.body,
        mainNavLinks: document.querySelectorAll('.main-nav a'),
        showAllBtns: document.querySelectorAll('.show-all-btn'),
        pages: document.querySelectorAll('.page'),
        coverImage: document.getElementById('cover-image'),
        statFilms: document.getElementById('stat-films'),
        statWatchlist: document.getElementById('stat-watchlist'),
        profileWatchedContainer: document.querySelector('#profile-watched .row-content'),
        profileWatchlistContainer: document.querySelector('#profile-watchlist .row-content'),
        profileFavouritesContainer: document.querySelector('#profile-favourites .row-content'),
        searchForm: document.getElementById('search-form'),
        searchInput: document.getElementById('search-input'),
        searchResults: document.getElementById('search-results'),
        watchlistContent: document.getElementById('watchlist-content'),
        watchedContent: document.getElementById('watched-content'),
        favouritesContent: document.getElementById('favourites-content'),
        customListsContent: document.getElementById('custom-lists-content'),
        createNewListBtn: document.getElementById('create-new-list-btn'),
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

    // --- HELPERS & API ---
    function setCookie(name, value, days) { let expires = ""; if (days) { const date = new Date(); date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000)); expires = "; expires=" + date.toUTCString(); } document.cookie = name + "=" + (value || "") + expires + "; path=/; SameSite=Lax; Secure"; }
    function getCookie(name) { const nameEQ = name + "="; const ca = document.cookie.split(';'); for (let c of ca) { c = c.trim(); if (c.startsWith(nameEQ)) return c.substring(nameEQ.length, c.length); } return null; }
    function setUserIdCookie() { const newUserId = crypto.randomUUID(); setCookie('movieTrackerUserId', newUserId, 365); return newUserId; }
    function toggleModal(modal, show) { if (!modal) return; modal.classList.toggle('show', show); }

    async function apiRequest(endpoint, method = 'GET', body = null) {
        if (method !== 'GET' && !state.adminPassword) {
            state.pendingAction = () => apiRequest(endpoint, method, body);
            toggleModal(G.passwordModal, true);
            return;
        }

        const headers = { 'Content-Type': 'application/json' };
        if (method !== 'GET' && state.adminPassword) {
            headers['X-Admin-Password'] = state.adminPassword;
        }

        const url = method === 'GET' ? `/api/${endpoint}?userId=${state.userId}` : `/api/${endpoint}`;
        
        try {
            const fetchOptions = { method, headers };
            if (body) fetchOptions.body = JSON.stringify(body);

            const response = await fetch(url, fetchOptions);
            
            if (!response.ok) {
                if (response.status === 401) {
                    state.adminPassword = null; setCookie('movieTrackerAdminPassword', '', -1);
                    state.pendingAction = () => apiRequest(endpoint, method, body);
                    toggleModal(G.passwordModal, true);
                    return;
                }
                throw new Error(`Server Error: ${response.status}`);
            }
            return method === 'GET' ? response.json() : { success: true };
        } catch (error) {
            console.error(`API Error (${method} on ${endpoint}):`, error);
            G.body.classList.add('loaded'); // Hide skeletons even on error
            return null;
        }
    }

    // --- DATA FETCHING ---
    async function fetchUserLists() {
        const data = await apiRequest('data', 'GET');
        if (!data) return;
        
        const sortMoviesByDate = (a, b) => new Date(b.date_added) - new Date(a.date_added);
        state.watchlist = data.standardLists.filter(m => m.list_type === 'watchlist').sort(sortMoviesByDate);
        state.watched = data.standardLists.filter(m => m.list_type === 'watched').sort(sortMoviesByDate);
        state.favourites = data.standardLists.filter(m => m.list_type === 'favourites').sort(sortMoviesByDate);
        
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
        G.body.classList.add('loaded');
    }
    
    // --- RENDERING LOGIC ---
    function renderProfilePage() {
        const mostRecentWatched = state.watched[0];
        if (mostRecentWatched && mostRecentWatched.poster_url !== 'N/A') {
            G.coverImage.style.backgroundImage = `url(${mostRecentWatched.poster_url})`;
        } else {
            G.coverImage.style.backgroundColor = '#333';
            G.coverImage.style.backgroundImage = '';
        }
        G.statFilms.textContent = state.watched.length;
        G.statWatchlist.textContent = state.watchlist.length;
        
        const createPosterCard = movie => `<div class="poster-card"><img src="${movie.poster_url !== 'N/A' ? movie.poster_url : 'https://placehold.co/300x450/f8f8f8/8e8e93?text=No+Image'}" alt="${movie.title}" loading="lazy"></div>`;
        const renderRow = (container, movies) => {
            container.innerHTML = movies.slice(0, 10).map(createPosterCard).join('') || `<p style="padding: 1rem 0; color: var(--text-secondary);">This list is empty.</p>`;
        };
        renderRow(G.profileWatchedContainer, state.watched);
        renderRow(G.profileWatchlistContainer, state.watchlist);
        renderRow(G.profileFavouritesContainer, state.favourites);
    }
    
    function renderFullListPage(contentEl, movies, emptyText) {
        const createMovieListItem = movie => {
            const isWatched = state.watched.some(m => m.imdb_id === movie.imdb_id);
            const isWatchlist = state.watchlist.some(m => m.imdb_id === movie.imdb_id);
            const isFavourite = state.favourites.some(m => m.imdb_id === movie.imdb_id);
            return `<div class="movie-item" data-id="${movie.imdb_id}">
                        <div class="movie-info">
                            <h3 class="movie-title">${movie.title}</h3>
                            <p class="movie-meta">${movie.year}</p>
                        </div>
                        <div class="movie-actions">
                            <button title="Toggle Watchlist" class="action-btn toggle-watchlist-btn ${isWatchlist ? 'toggled-on' : ''}">Watchlist</button>
                            <button title="Toggle Watched" class="action-btn add-to-watched-btn ${isWatched ? 'toggled-on' : ''}">Watched</button>
                            <button title="Toggle Favourite" class="action-btn toggle-favourite-btn ${isFavourite ? 'toggled-on' : ''}">Favourite</button>
                            <button title="Add to Custom List" class="action-btn add-to-list-btn">Add to List</button>
                        </div>
                    </div>`;
        };
        contentEl.innerHTML = movies.length > 0 ? movies.map(createMovieListItem).join('') : `<div class="empty-state">${emptyText}</div>`;
    }

    function renderCustomListsPage() {
        if (state.customLists.length === 0) {
            G.customListsContent.innerHTML = `<div class="empty-state">You haven't created any custom lists.</div>`; return;
        }
        G.customListsContent.innerHTML = state.customLists.map(list => `
            <div class="custom-list-section" data-id="${list.id}">
                <div class="section-header">
                    <h2 class="section-title">${list.name}</h2>
                    <button class="button delete-list-btn">Delete List</button>
                </div>
                <div class="list-container">${list.movies.length > 0 ? list.movies.map(m => `<div class="movie-item"><span>${m.title} (${m.year})</span></div>`).join('') : `<p style="color: var(--text-secondary); padding: 1rem 0;">This list is empty.</p>`}</div>
            </div>`).join('');
    }

    function renderAll() {
        renderProfilePage();
        renderFullListPage(G.watchlistContent, state.watchlist, 'Your watchlist is empty.');
        renderFullListPage(G.watchedContent, state.watched, 'You haven\'t marked any movies as watched.');
        renderFullListPage(G.favouritesContent, state.favourites, 'You have no favourite movies yet.');
        renderCustomListsPage();
    }
    
    // --- NAVIGATION ---
    function switchPage(pageId) {
        G.pages.forEach(p => p.classList.remove('active'));
        const newPage = document.getElementById(pageId);
        if (newPage) newPage.classList.add('active');
        G.mainNavLinks.forEach(link => link.classList.toggle('active', link.dataset.page === pageId));
        window.scrollTo(0, 0);
    }
    
    G.mainNavLinks.forEach(link => link.addEventListener('click', e => { e.preventDefault(); switchPage(e.target.dataset.page); }));
    G.showAllBtns.forEach(btn => btn.addEventListener('click', e => { e.preventDefault(); switchPage(e.target.dataset.page); }));

    // --- EVENT LISTENERS ---
    G.searchForm.addEventListener('submit', (e) => { 
        e.preventDefault(); 
        if (G.searchInput.value.trim()) searchOMDB(G.searchInput.value.trim()); 
    });
    
    async function searchOMDB(query) { 
        renderFullListPage(G.searchResults, [], `Searching for "${query}"...`);
        const response = await fetch(`https://www.omdbapi.com/?s=${encodeURIComponent(query)}&apikey=${state.omdbApiKey}`);
        const data = await response.json();
        state.currentSearch = data.Response === "True" ? data.Search.map(m => ({ imdb_id: m.imdbID, title: m.Title, year: m.Year, poster_url: m.Poster })) : [];
        renderFullListPage(G.searchResults, state.currentSearch, `No results for "${query}".`);
    }

    document.body.addEventListener('click', async (e) => {
        const actionBtn = e.target.closest('.action-btn');
        if (actionBtn) {
            const item = actionBtn.closest('.movie-item');
            const imdbId = item.dataset.id;
            const allMovies = [...state.currentSearch, ...state.watchlist, ...state.watched, ...state.favourites, ...state.customLists.flatMap(l => l.movies)];
            const movieData = allMovies.find(m => m.imdb_id === imdbId);
            if (!movieData) return;

            if (actionBtn.classList.contains('add-to-list-btn')) {
                state.movieToAddToList = movieData;
                G.customListOptions.innerHTML = state.customLists.map(l => `<button class="button" style="width: 100%; margin-bottom: 0.5rem;" data-id="${l.id}">${l.name}</button>`).join('') || '<p style="text-align: center; color: var(--text-secondary);">No custom lists yet.</p>';
                toggleModal(G.addToListModal, true);
                return;
            }

            const listType = actionBtn.classList.contains('toggle-watchlist-btn') ? 'watchlist'
                           : actionBtn.classList.contains('add-to-watched-btn') ? 'watched'
                           : actionBtn.classList.contains('toggle-favourite-btn') ? 'favourites' : '';
            
            if (listType) {
                const result = await apiRequest('modify', 'POST', { action: 'TOGGLE_STANDARD_LIST', userId: state.userId, listType, movie: movieData });
                if (result) {
                    await fetchUserLists();
                    if (document.getElementById('search').classList.contains('active')) {
                        renderFullListPage(G.searchResults, state.currentSearch, 'Search for a movie to get started.');
                    }
                }
            }
        }
        
        const deleteBtn = e.target.closest('.delete-list-btn');
        if (deleteBtn) {
            const listId = deleteBtn.closest('.custom-list-section').dataset.id;
            if (confirm('Are you sure you want to delete this entire list?')) {
                 const result = await apiRequest('modify', 'POST', { action: 'DELETE_LIST', userId: state.userId, listId });
                 if (result) await fetchUserLists();
            }
        }
    });
    
    G.customListOptions.addEventListener('click', async (e) => {
        const choiceBtn = e.target.closest('button');
        if (choiceBtn && state.movieToAddToList) {
            const listId = choiceBtn.dataset.id;
            const result = await apiRequest('modify', 'POST', { action: 'ADD_TO_CUSTOM_LIST', userId: state.userId, listId, movie: state.movieToAddToList });
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
            const result = await apiRequest('modify', 'POST', { action: 'CREATE_LIST', userId: state.userId, name: name.trim() });
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
            await fetchUserLists();
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

    // --- INITIALIZATION ---
    async function init() {
        if (!state.omdbApiKey) {
            toggleModal(G.apiKeyModal, true);
            G.body.classList.add('loaded'); // Hide skeletons if waiting for user input
        } else {
            await fetchUserLists();
        }
    }
    
    init();
});


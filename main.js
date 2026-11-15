const TMDB_API_KEY = '0d0a08318c19907d5486880402d48abc';
const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

async function fetchTmdb(path, params = {}) {
  const url = new URL(`${TMDB_API_BASE}/${path}`);
  url.searchParams.set('api_key', TMDB_API_KEY);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetch(url);
  if (!response.ok) throw new Error(`TMDb request failed (${response.status})`);
  return response.json();
}

document.addEventListener('alpine:init', () => {
  Alpine.data('filmaxApp', () => ({
    searchQuery: '',
    searchResults: [],
    searchLoading: false,
    searchRequestSequence: 0,
    searchMenuOpen: false,
    appPopoverOpen: false,
    isVoiceSearching: false,
    voiceRecognition: null,
    siteIntroVisible: true,
    introTimer: null,
    currentTab: 'home',
    activeSidebarPage: '',
    sidebarPageContent: {
      downloads: {
        title: 'Downloads',
        description: 'Offline downloads are not available in this version of FILMAX yet.',
        icon: 'download',
        action: 'Browse titles'
      },
      notifications: {
        title: 'Notifications',
        description: "You're all caught up. New notifications will appear here.",
        icon: 'bell',
        action: 'Back to Home'
      },
      settings: {
        title: 'Settings',
        description: 'Settings are not available in this version of FILMAX yet.',
        icon: 'settings-2',
        action: 'Back to Home'
      },
      profile: {
        title: 'Profile',
        description: 'Profile features are not available in this version of FILMAX yet.',
        icon: 'circle-user-round',
        action: 'Back to Home'
      }
    },
    activeGenre: '',
    genrePanelOpen: false,
    canScrollGenresLeft: false,
    canScrollGenresRight: false,
    sortBy: 'popular',
    isScrolled: false,
    mobileMenuOpen: false,
    sidebarOpen: false,
    sidebarNotice: '',
    genresLoading: true,
    watchingItem: null,
    watchTrailerKey: '',
    watchLoading: false,
    watchError: '',
    previewItem: null,
    previewTrailerKey: '',
    previewLoading: false,
    previewError: '',
    searchHistory: JSON.parse(localStorage.getItem('filmax_search_history') || '[]'),
    sidebarNoticeTimer: null,
    sidebarMainItems: [
      { id: 'home', label: 'Home', icon: 'house' },
      { id: 'popular', label: 'Popular', icon: 'flame' },
      { id: 'search', label: 'Search', icon: 'search' },
      { id: 'library', label: 'Library', icon: 'library' },
      { id: 'shorts', label: 'Shorts', icon: 'clapperboard' },
      { id: 'downloads', label: 'Downloads', icon: 'download' }
    ],
    sidebarAccountItems: [
      { id: 'notifications', label: 'Notifications', icon: 'bell' },
      { id: 'settings', label: 'Settings', icon: 'settings-2' },
      { id: 'profile', label: 'Profile', icon: 'circle-user-round' }
    ],
    activeDetails: null,
    isLoading: true,
    loadError: '',
    searchTimeout: null,
    requestSequence: 0,
    featuredTimer: null,
    isFeaturedPaused: false,
    genreMap: {},

    // Saved Watchlist State
    watchlist: JSON.parse(localStorage.getItem('filmax_watchlist') || '[]'),

    genres: [],

    // Populated from TMDb on startup.
    featuredMovie: {
      id: null,
      title: 'Loading titles...',
      description: '',
      poster: '',
      backdrop: '',
      trailerUrl: '',
      rating: '',
      year: '',
      quality: 'Trending',
      duration: '',
      type: 'movie',
      genres: []
    },
    featuredTrailerLoading: false,

    movies: [],
    curatedSectionsData: {},
    curatedSectionRowsData: {},
    curatedSectionErrors: {},
    curatedSectionLoading: {},

    init() {
      this.reInitIcons();
      this.voiceSearchSupported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
      this.introTimer = window.setTimeout(() => this.finishIntro(), 4000);
      this.$watch('searchQuery', (query) => {
        window.clearTimeout(this.searchTimeout);
        this.searchTimeout = window.setTimeout(() => {
          const value = query.trim();
          this.loadSearchSuggestions(value);
          if (this.currentTab === 'search') this.loadMedia(value);
        }, 300);
      });
      window.addEventListener('popstate', () => this.syncWatchRoute());
      this.loadGenres().finally(() => this.loadMedia());
      this.loadCuratedSections();
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.featuredTimer = window.setInterval(() => {
          if (!this.isFeaturedPaused && !this.searchQuery && !this.activeGenre && this.currentTab === 'home') {
            this.advanceFeatured();
          }
        }, 5000);
      }
    },

    finishIntro() {
      window.clearTimeout(this.introTimer);
      this.siteIntroVisible = false;
    },

    async copyAppLink() {
      try {
        await navigator.clipboard.writeText(window.location.href);
        this.showSidebarNotice('Link copied!');
      } catch {
        this.showSidebarNotice('Could not copy the link.');
      }
    },

    updateGenreScroll() {
      const scroller = this.$refs.genreScroller;
      if (!scroller) return;

      this.canScrollGenresLeft = scroller.scrollLeft > 1;
      this.canScrollGenresRight = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1;
    },

    scrollGenres(direction) {
      const scroller = this.$refs.genreScroller;
      if (!scroller) return;

      scroller.scrollBy({
        left: direction * Math.max(scroller.clientWidth * 0.75, 120),
        behavior: 'smooth'
      });
    },

    toggleVoiceSearch() {
      if (this.isVoiceSearching) {
        this.voiceRecognition?.stop();
        return;
      }

      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) {
        this.showSidebarNotice('Voice search is not supported in this browser.');
        return;
      }

      const recognition = new Recognition();
      recognition.lang = navigator.language || 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => {
        this.isVoiceSearching = true;
        window.clearTimeout(this.sidebarNoticeTimer);
        this.sidebarNotice = 'Listening for a movie title...';
      };
      recognition.onresult = event => {
        const transcript = event.results?.[0]?.[0]?.transcript?.trim();
        if (!transcript) return;
        this.searchQuery = transcript;
        this.searchMenuOpen = true;
        this.saveSearchHistory(transcript);
      };
      recognition.onerror = event => {
        const message = event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'Microphone access was denied.'
          : 'Voice search could not hear that. Please try again.';
        this.showSidebarNotice(message);
      };
      recognition.onend = () => {
        this.isVoiceSearching = false;
        this.voiceRecognition = null;
        if (this.sidebarNotice === 'Listening for a movie title...') {
          this.sidebarNotice = '';
          window.clearTimeout(this.sidebarNoticeTimer);
        }
      };

      this.voiceRecognition = recognition;
      try {
        recognition.start();
      } catch {
        this.isVoiceSearching = false;
        this.voiceRecognition = null;
        this.showSidebarNotice('Could not start voice search. Please try again.');
      }
    },

    showSidebarNotice(message) {
      window.clearTimeout(this.sidebarNoticeTimer);
      this.sidebarNotice = message;
      this.sidebarNoticeTimer = window.setTimeout(() => {
        this.sidebarNotice = '';
      }, 2800);
    },

    async loadCuratedSections() {
      const feeds = [
        { key: 'new-releases', title: 'New Released', path: 'movie/now_playing', type: 'movie', params: {} },
        { key: 'popular-movies', title: 'Popular Movies', path: 'movie/popular', type: 'movie', params: {} },
        { key: 'popular-series', title: 'Popular Series', path: 'tv/popular', type: 'tv', params: {} },
        { key: 'animation-families', title: 'Animation Families', path: 'discover/movie', type: 'movie', params: { with_genres: '16,10751', sort_by: 'popularity.desc' } },
        { key: 'anime-films', title: 'Anime Films (English Dub Unverified)', path: 'discover/movie', type: 'movie', note: 'TMDb does not report dubbed audio tracks; check each title for English dub availability.', params: { with_genres: '16', with_original_language: 'ja', sort_by: 'popularity.desc' } },
        { key: 'horror-movies', title: 'Horror Movies', path: 'discover/movie', type: 'movie', params: { with_genres: '27', sort_by: 'popularity.desc' } },
        { key: 'teen-romance', title: 'Teen Romance', path: 'discover/movie', type: 'movie', params: { with_genres: '18,10749', with_keywords: '2080', sort_by: 'popularity.desc' } },
        { key: 'action-movies', title: 'Action Movies', path: 'discover/movie', type: 'movie', params: { with_genres: '28', sort_by: 'popularity.desc' } },
        { key: 'action-thrillers', title: 'Action & Thrillers', path: 'discover/movie', type: 'movie', params: { with_genres: '28,53', sort_by: 'popularity.desc' } },
        { key: 'k-drama', title: 'K-Drama', path: 'discover/tv', type: 'tv', params: { with_original_language: 'ko', with_genres: '18', sort_by: 'popularity.desc' } },
        { key: 'coming-soon', title: 'Coming Soon', path: 'movie/upcoming', type: 'movie', params: {} },
        { key: 'c-drama', title: 'C-Drama', path: 'discover/tv', type: 'tv', params: { with_original_language: 'zh', with_genres: '18', sort_by: 'popularity.desc' } },
        { key: 'romantic', title: 'Romantic', path: 'discover/movie', type: 'movie', params: { with_genres: '10749', sort_by: 'popularity.desc' } },
        { key: 'epic-fantasy', title: 'Epic Fantasy', path: 'discover/movie', type: 'movie', params: { with_genres: '14', sort_by: 'popularity.desc' } },
        { key: 'comedy', title: 'Comedy', path: 'discover/movie', type: 'movie', params: { with_genres: '35', sort_by: 'popularity.desc' } },
        { key: 'superhero-series', title: 'Superhero Series', path: 'discover/tv', type: 'tv', keyword: 'superhero', params: { with_genres: '10759', sort_by: 'popularity.desc' } },
        {
          key: 'bl-story',
          title: 'BL Story',
          sources: [
            { path: 'discover/tv', type: 'tv', keyword: 'boys love', params: { with_genres: '18,10749', sort_by: 'popularity.desc' } },
            { path: 'discover/movie', type: 'movie', keyword: 'boys love', params: { with_genres: '18,10749', sort_by: 'popularity.desc' } }
          ]
        },
        { key: 'bet-plus', title: 'BET+ (US)', provider: 'BET+', region: 'US' },
        {
          key: 'gangster',
          title: 'Gangster Movies & Shows',
          sources: [
            { path: 'discover/movie', type: 'movie', keyword: 'gangster', params: { with_genres: '80', sort_by: 'popularity.desc' } },
            { path: 'discover/tv', type: 'tv', keyword: 'gangster', params: { with_genres: '80', sort_by: 'popularity.desc' } }
          ]
        },
        { key: 'teen-fantasy', title: 'Teen Fantasy', path: 'discover/movie', type: 'movie', params: { with_genres: '14,10751', with_keywords: '2080', sort_by: 'popularity.desc' } },
        {
          key: 'free-now',
          title: 'Free Now (US)',
          sources: [
            { path: 'discover/movie', type: 'movie', params: { watch_region: 'US', with_watch_monetization_types: 'free|ads', sort_by: 'popularity.desc' } },
            { path: 'discover/tv', type: 'tv', params: { watch_region: 'US', with_watch_monetization_types: 'free|ads', sort_by: 'popularity.desc' } }
          ]
        },
        { key: 'hot-short-tv', title: 'Hot Short TV', path: 'discover/tv', type: 'tv', params: { 'with_episode_runtime.lte': '20', sort_by: 'popularity.desc' } },
        {
          key: 'best-black-shows',
          title: 'Best Black Shows',
          note: 'Titles are selected using TMDb subject tags, which may not reflect cast representation.',
          path: 'discover/tv',
          type: 'tv',
          keyword: 'black people',
          params: { sort_by: 'popularity.desc' }
        },
        { key: 'most-trending', title: 'Most Trending', path: 'trending/all/week', type: 'mixed', params: {}, yearRows: [2023, 2024, 2025, 2026] }
      ];

      this.curatedSectionLoading = Object.fromEntries(feeds.map(feed => [feed.key, true]));

      const keywordRequests = new Map();
      const findKeywordId = term => {
        if (!keywordRequests.has(term)) {
          keywordRequests.set(term, fetchTmdb('search/keyword', { query: term }).then(data => {
            const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
            const keyword = (data.results || []).find(result => normalize(result.name) === normalize(term));
            if (!keyword) throw new Error(`TMDb has no matching "${term}" keyword.`);
            return keyword.id;
          }));
        }
        return keywordRequests.get(term);
      };

      const loadSource = async source => {
        const params = { ...source.params };
        if (source.keyword) params.with_keywords = String(await findKeywordId(source.keyword));
        const data = await fetchTmdb(source.path, { ...params, language: 'en-US', page: '1' });
        return (data.results || [])
          .filter(item => item.poster_path && (source.type !== 'mixed' || ['movie', 'tv'].includes(item.media_type)))
          .map(item => this.normalizeMedia({ ...item, media_type: source.type === 'mixed' ? item.media_type : source.type }));
      };

      const loadBetPlus = async region => {
        const providerLists = await Promise.all([
          fetchTmdb('watch/providers/movie', { language: 'en-US' }),
          fetchTmdb('watch/providers/tv', { language: 'en-US' })
        ]);
        const normalize = value => value.toLowerCase().replace(/\+/g, 'plus').replace(/[^a-z0-9]/g, '');
        const providers = providerLists.flatMap(data => data.results || []);
        const providerId = providers.find(provider => normalize(provider.provider_name) === 'betplus')?.provider_id;
        if (!providerId) throw new Error(`BET+ is not listed as a TMDb streaming provider in ${region}.`);

        const titles = await Promise.all([
          { path: 'discover/movie', type: 'movie' },
          { path: 'discover/tv', type: 'tv' }
        ].map(async source => {
          const data = await fetchTmdb(source.path, {
            language: 'en-US',
            page: '1',
            watch_region: region,
            with_watch_providers: String(providerId),
            with_watch_monetization_types: 'flatrate',
            sort_by: 'popularity.desc'
          });
          return (data.results || [])
            .filter(item => item.poster_path)
            .map(item => this.normalizeMedia({ ...item, media_type: source.type }));
        }));
        const results = titles.flat().slice(0, 20);
        if (!results.length) throw new Error(`TMDb has no BET+ subscription titles listed in ${region} right now.`);
        return results;
      };

      await Promise.all(feeds.map(async feed => {
        this.curatedSectionErrors[feed.key] = '';
        this.curatedSectionRowsData[feed.key] = null;
        try {
          if (feed.provider) {
            this.curatedSectionsData[feed.key] = await loadBetPlus(feed.region);
          } else if (feed.yearRows) {
            const currentItems = (await loadSource(feed)).slice(0, 20);
            const yearRows = await Promise.all(feed.yearRows.map(async year => {
              const startDate = `${year}-01-01`;
              const endDate = year === new Date().getFullYear()
                ? new Date().toISOString().slice(0, 10)
                : `${year}-12-31`;
              const titles = await Promise.all([
                loadSource({
                  path: 'discover/movie',
                  type: 'movie',
                  params: {
                    'primary_release_date.gte': startDate,
                    'primary_release_date.lte': endDate,
                    sort_by: 'popularity.desc'
                  }
                }),
                loadSource({
                  path: 'discover/tv',
                  type: 'tv',
                  params: {
                    'first_air_date.gte': startDate,
                    'first_air_date.lte': endDate,
                    sort_by: 'popularity.desc'
                  }
                })
              ]);
              return {
                id: `${feed.key}-${year}`,
                label: `Popular titles from ${year}`,
                items: titles.flat().sort((a, b) => b.popularity - a.popularity).slice(0, 20)
              };
            }));
            this.curatedSectionsData[feed.key] = currentItems;
            this.curatedSectionRowsData[feed.key] = [
              { id: `${feed.key}-current`, label: 'Current weekly trends', items: currentItems },
              ...yearRows
            ];
          } else if (feed.sources) {
            const titles = await Promise.all(feed.sources.map(loadSource));
            this.curatedSectionsData[feed.key] = titles.flat().slice(0, 20);
          } else {
            this.curatedSectionsData[feed.key] = (await loadSource(feed)).slice(0, 20);
          }
        } catch (error) {
          this.curatedSectionsData[feed.key] = [];
          this.curatedSectionRowsData[feed.key] = null;
          this.curatedSectionErrors[feed.key] = `Could not load ${feed.title}: ${error.message}`;
          console.error(`Failed to load ${feed.title}`, error);
        } finally {
          this.curatedSectionLoading[feed.key] = false;
        }
      }));

      this.reInitIcons();
    },

    async loadGenres() {
      this.genresLoading = true;
      try {
        const [movieGenres, tvGenres] = await Promise.all([
          fetchTmdb('genre/movie/list', { language: 'en-US' }),
          fetchTmdb('genre/tv/list', { language: 'en-US' })
        ]);
        const allGenres = [...movieGenres.genres, ...tvGenres.genres];
        this.genreMap = Object.fromEntries(allGenres.map(genre => [genre.id, genre.name]));
        this.genres = [...new Set(allGenres.map(genre => genre.name))].sort();
      } catch {
        this.genres = [];
      } finally {
        this.genresLoading = false;
      }
    },

    async loadMedia(query = '') {
      const requestSequence = ++this.requestSequence;
      this.isLoading = true;
      this.loadError = '';

      try {
        const isSearch = Boolean(query);
        const data = await fetchTmdb(
          isSearch ? 'search/multi' : 'trending/all/week',
          isSearch
            ? { query, include_adult: 'false', language: 'en-US' }
            : { language: 'en-US', page: '1' }
        );

        if (requestSequence !== this.requestSequence) return;

        this.movies = (data.results || [])
          .filter(item => item.media_type !== 'person' && item.poster_path)
          .map(item => this.normalizeMedia(item));

        if (!isSearch && this.movies.length) {
          this.featuredMovie = this.movies[0];
          this.loadFeaturedTrailer(this.featuredMovie);
        }
      } catch {
        if (requestSequence === this.requestSequence) {
          this.loadError = 'Could not load titles from TMDb. Check the API key and connection, then try again.';
        }
      } finally {
        if (requestSequence === this.requestSequence) this.isLoading = false;
        this.reInitIcons();
      }
    },

    async loadSearchSuggestions(query) {
      const requestSequence = ++this.searchRequestSequence;
      if (!query) {
        this.searchResults = [];
        this.searchLoading = false;
        return;
      }

      this.searchLoading = true;
      try {
        const data = await fetchTmdb('search/multi', {
          query,
          include_adult: 'false',
          language: 'en-US'
        });
        if (requestSequence !== this.searchRequestSequence) return;

        this.searchResults = (data.results || [])
          .filter(item => item.media_type !== 'person' && item.poster_path)
          .slice(0, 8)
          .map(item => this.normalizeMedia(item));
      } catch {
        if (requestSequence === this.searchRequestSequence) this.searchResults = [];
      } finally {
        if (requestSequence === this.searchRequestSequence) this.searchLoading = false;
      }
    },

    normalizeMedia(item) {
      const type = item.media_type === 'tv' || (!item.media_type && item.name) ? 'tv' : 'movie';
      const poster = item.poster_path ? `${TMDB_IMAGE_BASE}/w500${item.poster_path}` : '';
      const backdrop = item.backdrop_path ? `${TMDB_IMAGE_BASE}/w1280${item.backdrop_path}` : poster;
      const date = type === 'tv' ? item.first_air_date : item.release_date;

      return {
        id: `${type}-${item.id}`,
        tmdbId: item.id,
        type,
        title: item.title || item.name || 'Untitled',
        poster,
        backdrop,
        trailerUrl: '',
        rating: Number(item.vote_average || 0).toFixed(1),
        popularity: Number(item.popularity || 0),
        year: date ? date.slice(0, 4) : '—',
        quality: type === 'tv' ? 'TV Series' : 'Movie',
        duration: type === 'tv' ? 'TV Series' : 'Feature Film',
        genres: (item.genre_ids || []).map(id => this.genreMap[id]).filter(Boolean),
        description: item.overview || 'No overview is available for this title.'
      };
    },

    get featuredOptions() {
      return this.movies.filter(item => item.id !== this.featuredMovie.id).slice(0, 12);
    },

    get extraMovieSections() {
      return [
        { id: 'new-releases', title: 'New Released', icon: 'calendar-days' },
        { id: 'popular-movies', title: 'Popular Movies', icon: 'flame' },
        { id: 'popular-series', title: 'Popular Series', icon: 'tv' },
        { id: 'animation-families', title: 'Animation Families', icon: 'clapperboard' },
        { id: 'anime-films', title: 'Anime Films (English Dub Unverified)', icon: 'sparkles', note: 'TMDb does not report dubbed audio tracks; check each title for English dub availability.' },
        { id: 'horror-movies', title: 'Horror Movies', icon: 'ghost' },
        { id: 'teen-romance', title: 'Teen Romance', icon: 'heart' },
        { id: 'action-movies', title: 'Action Movies', icon: 'swords' },
        { id: 'action-thrillers', title: 'Action & Thrillers', icon: 'zap' },
        { id: 'k-drama', title: 'K-Drama', icon: 'tv' },
        { id: 'coming-soon', title: 'Coming Soon', icon: 'calendar-clock' },
        { id: 'c-drama', title: 'C-Drama', icon: 'tv' },
        { id: 'romantic', title: 'Romantic', icon: 'heart' },
        { id: 'epic-fantasy', title: 'Epic Fantasy', icon: 'swords' },
        { id: 'comedy', title: 'Comedy', icon: 'laugh' },
        { id: 'superhero-series', title: 'Superhero Series', icon: 'shield' },
        { id: 'bl-story', title: 'BL Story', icon: 'heart-handshake' },
        { id: 'bet-plus', title: 'BET+ (US)', icon: 'tv' },
        { id: 'gangster', title: 'Gangster Movies & Shows', icon: 'drama' },
        { id: 'teen-fantasy', title: 'Teen Fantasy', icon: 'wand-sparkles' },
        { id: 'free-now', title: 'Free Now (US)', icon: 'badge-dollar-sign' },
        { id: 'hot-short-tv', title: 'Hot Short TV', icon: 'tv' },
        { id: 'best-black-shows', title: 'Best Black Shows', icon: 'clapperboard', note: 'Titles are selected using TMDb subject tags, which may not reflect cast representation.' },
        { id: 'most-trending', title: 'Most Trending', icon: 'trending-up' }
      ].map(section => ({
        ...section,
        items: this.curatedSectionsData[section.id] || [],
        rows: this.curatedSectionRowsData[section.id] || [{
          id: section.id,
          label: section.title,
          items: this.curatedSectionsData[section.id] || []
        }],
        loading: Boolean(this.curatedSectionLoading[section.id]),
        error: this.curatedSectionErrors[section.id] || ''
      }));
    },

    selectFeatured(item) {
      this.featuredMovie = { ...item, trailerUrl: '' };
      this.loadFeaturedTrailer(this.featuredMovie);
    },

    advanceFeatured() {
      if (this.movies.length < 2) return;
      const currentIndex = this.movies.findIndex(item => item.id === this.featuredMovie.id);
      const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % this.movies.length;
      const item = this.movies[nextIndex];
      this.featuredMovie = { ...item, trailerUrl: '' };
      this.loadFeaturedTrailer(this.featuredMovie);
    },

    async loadFeaturedTrailer(item) {
      this.featuredTrailerLoading = true;
      try {
        const data = await fetchTmdb(`${item.type}/${item.tmdbId}/videos`, { language: 'en-US' });
        const videos = data.results || [];
        const trailer = videos.find(video => video.site === 'YouTube' && video.type === 'Trailer' && video.official)
          || videos.find(video => video.site === 'YouTube' && video.type === 'Trailer');

        if (trailer && this.featuredMovie.tmdbId === item.tmdbId) {
          this.featuredMovie = {
            ...this.featuredMovie,
            trailerUrl: `https://www.youtube.com/watch?v=${trailer.key}`
          };
        }
      } catch {
        // Keep the backdrop visible when trailer metadata is unavailable.
      } finally {
        if (this.featuredMovie.tmdbId === item.tmdbId) {
          this.featuredTrailerLoading = false;
        }
      }
    },

    openWatchPage(item) {
      if (!item) return;
      window.history.pushState({ watchId: item.id }, '', `#watch/${encodeURIComponent(item.id)}`);
      this.loadWatchItem(item);
    },

    async openTrailerPreview(item) {
      if (!item) return;
      this.previewItem = item;
      this.previewTrailerKey = '';
      this.previewError = '';
      this.previewLoading = true;

      try {
        const data = await fetchTmdb(`${item.type}/${item.tmdbId}/videos`, { language: 'en-US' });
        if (this.previewItem?.id !== item.id) return;

        const videos = data.results || [];
        const trailer = videos.find(video => video.site === 'YouTube' && video.type === 'Trailer' && video.official)
          || videos.find(video => video.site === 'YouTube' && video.type === 'Trailer');

        if (trailer) {
          this.previewTrailerKey = trailer.key;
        } else {
          this.previewError = 'No official trailer is available for this title.';
        }
      } catch {
        if (this.previewItem?.id === item.id) {
          this.previewError = 'Could not load the trailer. Please try again.';
        }
      } finally {
        if (this.previewItem?.id === item.id) {
          this.previewLoading = false;
          this.reInitIcons();
        }
      }
    },

    closeTrailerPreview() {
      this.previewItem = null;
      this.previewTrailerKey = '';
      this.previewLoading = false;
      this.previewError = '';
    },

    scrollCarousel(id, direction) {
      const carousel = document.getElementById(id);
      if (!carousel) return;

      carousel.scrollBy({
        left: direction * Math.max(carousel.clientWidth * 0.8, 220),
        behavior: 'smooth'
      });
    },

    async loadWatchItem(item) {
      this.watchingItem = item;
      this.watchTrailerKey = '';
      this.watchError = '';
      this.watchLoading = true;

      try {
        const data = await fetchTmdb(`${item.type}/${item.tmdbId}/videos`, { language: 'en-US' });
        if (this.watchingItem?.id !== item.id) return;

        const videos = data.results || [];
        const trailer = videos.find(video => video.site === 'YouTube' && video.type === 'Trailer' && video.official)
          || videos.find(video => video.site === 'YouTube' && video.type === 'Trailer');

        if (trailer) {
          this.watchTrailerKey = trailer.key;
        } else {
          this.watchError = 'No official trailer is available for this title.';
        }
      } catch {
        if (this.watchingItem?.id === item.id) {
          this.watchError = 'Could not load the trailer. Please check your connection and try again.';
        }
      } finally {
        if (this.watchingItem?.id === item.id) {
          this.watchLoading = false;
          this.reInitIcons();
        }
      }
    },

    syncWatchRoute() {
      const match = window.location.hash.match(/^#watch\/(.+)$/);
      if (!match) {
        this.watchingItem = null;
        this.watchTrailerKey = '';
        this.watchLoading = false;
        return;
      }

      const id = decodeURIComponent(match[1]);
      const item = [...this.movies, this.featuredMovie].find(title => title?.id === id);
      if (item) this.loadWatchItem(item);
    },

    closeWatchPage() {
      if (window.location.hash.startsWith('#watch/')) {
        window.history.back();
      } else {
        this.watchingItem = null;
        this.watchTrailerKey = '';
      }
    },

    get searchSuggestions() {
      const query = (this.searchQuery || '').trim().toLowerCase();

      const historySuggestions = this.searchHistory.slice(0, 4).map((value, index) => ({
        id: `history-${index}`,
        label: value,
        badge: 'History',
        type: 'history',
        item: null
      }));

      if (!query) {
        return historySuggestions.slice(0, 6);
      }

      const filtered = this.searchResults.filter(item => {
        return item.title.toLowerCase().includes(query) || item.genres.some(g => g.toLowerCase().includes(query));
      }).slice(0, 6).map(item => ({
        id: `title-${item.id}`,
        label: item.title,
        badge: item.type === 'tv' ? 'TV' : 'Movie',
        type: 'title',
        item
      }));

      const recentMatches = historySuggestions.filter(suggestion => suggestion.label.toLowerCase().includes(query));
      return [...recentMatches, ...filtered].slice(0, 8);
    },

    saveSearchHistory(query) {
      const value = (query || '').trim();
      if (!value) return;
      const next = [value, ...this.searchHistory.filter(item => item.toLowerCase() !== value.toLowerCase())].slice(0, 6);
      this.searchHistory = next;
      localStorage.setItem('filmax_search_history', JSON.stringify(next));
    },

    openSearchExplore() {
      this.searchMenuOpen = true;
      this.$nextTick(() => {
        const field = document.querySelector('.filmax-search-input');
        field?.focus();
        field?.select?.();
      });
    },

    selectSearchSuggestion(suggestion) {
      const value = suggestion?.label || suggestion?.title || '';
      if (!value) return;

      this.searchMenuOpen = false;
      this.searchQuery = value;
      this.currentTab = 'search';

      if (suggestion?.type === 'history') {
        this.activeGenre = '';
        this.sortBy = 'popular';
        this.saveSearchHistory(value);
        this.loadMedia(value);
        return;
      }

      if (suggestion?.type === 'top-rated') {
        this.currentTab = 'home';
        this.activeGenre = '';
        this.sortBy = 'rating';
        this.saveSearchHistory(value);
        return;
      }

      if (suggestion?.type === 'most-watched') {
        this.currentTab = 'home';
        this.activeGenre = '';
        this.sortBy = 'popular';
        this.saveSearchHistory(value);
        return;
      }

      this.saveSearchHistory(value);
      this.loadMedia(value);
    },

    // Filter Computed Data
    get filteredMedia() {
      let result = [...this.movies];

      // Tab Filtering
      if (this.currentTab === 'movies') {
        result = result.filter(m => m.type === 'movie');
      } else if (this.currentTab === 'tv') {
        result = result.filter(m => m.type === 'tv');
      } else if (this.currentTab === 'watchlist') {
        result = result.filter(m => this.watchlist.includes(m.id));
      }

      // Genre Filtering
      if (this.activeGenre) {
        result = result.filter(m => m.genres.includes(this.activeGenre));
      }

      // Live Text Search Filtering
      if (this.currentTab === 'search' && this.searchQuery.trim()) {
        const query = this.searchQuery.toLowerCase();
        result = result.filter(m => 
          m.title.toLowerCase().includes(query) || 
          m.genres.some(g => g.toLowerCase().includes(query))
        );
      }

      // Sort Order
      if (this.sortBy === 'rating') {
        result.sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
      } else if (this.sortBy === 'latest') {
        result.sort((a, b) => parseInt(b.year) - parseInt(a.year));
      }

      return result;
    },

    // Genre Selector Handler
    setGenre(genre) {
      this.activeSidebarPage = '';
      this.activeGenre = genre;
      this.currentTab = 'home';
      this.reInitIcons();
    },

    navigateTo(section) {
      this.mobileMenuOpen = false;
      this.genrePanelOpen = false;
      this.activeSidebarPage = '';
      this.activeGenre = '';
      this.searchQuery = '';

      if (section === 'movie') {
        this.currentTab = 'movies';
        this.sortBy = 'popular';
      } else if (section === 'tv' || section === 'shorttv') {
        this.currentTab = 'tv';
        this.sortBy = section === 'shorttv' ? 'latest' : 'popular';
      } else if (section === 'community') {
        this.currentTab = 'home';
        this.sortBy = 'rating';
      } else if (section === 'anime') {
        this.sortBy = 'popular';
        this.setGenre(this.genres.includes('Animation') ? 'Animation' : '');
        if (!this.genres.includes('Animation')) this.searchQuery = 'anime';
      } else if (section === 'kids') {
        this.sortBy = 'popular';
        this.setGenre(this.genres.includes('Family') ? 'Family' : '');
        if (!this.genres.includes('Family')) this.searchQuery = 'kids';
      } else {
        this.currentTab = 'home';
        this.sortBy = 'popular';
      }
    },

    navigateSidebar(section) {
      this.mobileMenuOpen = false;
      this.sidebarNotice = '';
      window.clearTimeout(this.sidebarNoticeTimer);
      this.activeDetails = null;
      this.previewItem = null;
      this.previewTrailerKey = '';
      this.previewLoading = false;

      if (this.watchingItem || window.location.hash.startsWith('#watch/')) {
        this.watchingItem = null;
        this.watchTrailerKey = '';
        this.watchLoading = false;
        this.watchError = '';
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
      }

      if (section === 'home' || section === 'popular') {
        this.activeSidebarPage = '';
        this.resetFilters();
        this.sortBy = 'popular';
      } else if (section === 'search') {
        this.activeSidebarPage = '';
        this.currentTab = 'search';
        this.activeGenre = '';
        this.sortBy = 'popular';
        this.searchMenuOpen = true;
        this.$nextTick(() => {
          const searchInput = document.querySelector('.filmax-search-input');
          searchInput?.focus();
          searchInput?.select?.();
        });
      } else if (section === 'library') {
        this.activeSidebarPage = '';
        this.currentTab = 'watchlist';
        this.activeGenre = '';
        this.searchQuery = '';
      } else if (section === 'shorts') {
        this.activeSidebarPage = '';
        this.currentTab = 'tv';
        this.sortBy = 'latest';
        this.activeGenre = '';
        this.searchQuery = '';
      } else {
        this.activeSidebarPage = section;
        this.currentTab = 'sidebar';
        this.activeGenre = '';
        this.searchQuery = '';
      }

      this.reInitIcons();
    },

    // Reset Filters
    resetFilters() {
      this.searchQuery = '';
      this.activeGenre = '';
      this.currentTab = 'home';
      this.activeSidebarPage = '';
      this.reInitIcons();
    },

    // Watchlist Persistence Handler
    toggleWatchlist(item) {
      if (!item) return;
      const index = this.watchlist.indexOf(item.id);
      if (index > -1) {
        this.watchlist.splice(index, 1);
      } else {
        this.watchlist.push(item.id);
      }
      localStorage.setItem('filmax_watchlist', JSON.stringify(this.watchlist));
      this.reInitIcons();
    },

    isInWatchlist(id) {
      return this.watchlist.includes(id);
    },

    // Title Details Handlers
    openDetails(item) {
      this.activeDetails = item;
      this.reInitIcons();
    },

    closeDetails() {
      this.activeDetails = null;
    },

    reInitIcons() {
      this.$nextTick(() => {
        if (window.lucide) {
          lucide.createIcons();
        }
      });
    }
  }));
});
import { useEffect, useState } from 'react';

export function useMediaQuery(query, defaultState = false) {
  const getMatches = () => {
    if (typeof window === 'undefined') return defaultState;
    return window.matchMedia(query).matches;
  };

  const [matches, setMatches] = useState(getMatches);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);

    const onChange = (e) => setMatches(e.matches);

    // Safari fallback
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else mql.addListener(onChange);

    setMatches(mql.matches);

    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange);
      else mql.removeListener(onChange);
    };
  }, [query]);

  return matches;
}


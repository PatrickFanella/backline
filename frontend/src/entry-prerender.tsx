import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';

import { ThemeProvider } from './contexts/ThemeContext';
import BacklineLanding from './pages/BacklineLanding';

export function render() {
    return renderToString(
        <StaticRouter location="/">
            <ThemeProvider>
                <BacklineLanding />
            </ThemeProvider>
        </StaticRouter>
    );
}

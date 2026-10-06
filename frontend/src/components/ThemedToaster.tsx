import { Toaster } from 'react-hot-toast';

export function ThemedToaster() {
    return (
        <Toaster
            position="top-right"
            toastOptions={{
                style: {
                    background: 'rgb(var(--bl-panel))',
                    color: 'rgb(var(--bl-ink))',
                    border: '2px solid rgb(var(--bl-border))',
                    borderRadius: '4px',
                    fontFamily: 'Backline Space, sans-serif',
                },
                success: {
                    iconTheme: {
                        primary: 'rgb(var(--bl-success))',
                        secondary: 'rgb(var(--bl-panel))',
                    },
                },
                error: {
                    iconTheme: {
                        primary: 'rgb(var(--bl-danger))',
                        secondary: 'rgb(var(--bl-panel))',
                    },
                },
            }}
        />
    );
}

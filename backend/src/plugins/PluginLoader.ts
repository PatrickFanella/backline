import { EventEmitter } from 'events';
import * as fs from 'fs';
import { createRequire } from 'module';
import * as path from 'path';

import { Client } from 'discord.js';
import { Express, Router } from 'express';

import { db } from '../db';
import { websocketService } from '../services/websocket';
import { getRedisClient } from '../utils/redis';

import {
    Plugin,
    PluginContext,
    PluginEventEmitter,
    PluginHookHandler,
    PluginHookRegistry,
    PluginHookType,
    PluginInstance,
    PluginLoaderConfig,
    PluginManifest,
    PluginPermission,
    PluginState,
} from './types';

const requirePluginModule = createRequire(__filename);
const pluginPermissions = new Set<string>(Object.values(PluginPermission));

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isPluginManifest(value: unknown): value is PluginManifest {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        typeof value.name === 'string' &&
        typeof value.version === 'string' &&
        typeof value.author === 'string' &&
        typeof value.description === 'string' &&
        (value.dependencies === undefined ||
            (Array.isArray(value.dependencies) &&
                value.dependencies.every(
                    (dependency) => typeof dependency === 'string'
                ))) &&
        (value.permissions === undefined ||
            (Array.isArray(value.permissions) &&
                value.permissions.every(
                    (permission) =>
                        typeof permission === 'string' &&
                        pluginPermissions.has(permission)
                )))
    );
}

function isPlugin(value: unknown): value is Plugin {
    return (
        isRecord(value) &&
        isPluginManifest(value.manifest) &&
        typeof value.init === 'function'
    );
}

/**
 * Plugin loader manages loading, initialization, and lifecycle of plugins
 */
export class PluginLoader {
    private plugins: Map<string, PluginInstance> = new Map();
    private hooks: Map<PluginHookType, PluginHookHandler[]> = new Map();
    private config: PluginLoaderConfig;
    private discordClient?: Client;
    private app?: Express;
    private eventEmitter: EventEmitter;

    constructor(config: PluginLoaderConfig) {
        this.config = config;
        this.eventEmitter = new EventEmitter();
        this.ensureDirectories();
    }

    /**
     * Set Discord client for plugins
     */
    setDiscordClient(client: Client): void {
        this.discordClient = client;
    }

    /**
     * Set Express app for plugins
     */
    setExpressApp(app: Express): void {
        this.app = app;
    }

    /**
     * Ensure plugin directories exist
     */
    private ensureDirectories(): void {
        if (!fs.existsSync(this.config.pluginDir)) {
            fs.mkdirSync(this.config.pluginDir, { recursive: true });
        }
        if (!fs.existsSync(this.config.dataDir)) {
            fs.mkdirSync(this.config.dataDir, { recursive: true });
        }
    }

    /**
     * Discover plugins in the plugin directory
     */
    discoverPlugins(): Promise<string[]> {
        const pluginDirs: string[] = [];
        const entries = fs.readdirSync(this.config.pluginDir, {
            withFileTypes: true,
        });

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const manifestPath = path.join(
                    this.config.pluginDir,
                    entry.name,
                    'manifest.json'
                );
                if (fs.existsSync(manifestPath)) {
                    pluginDirs.push(entry.name);
                }
            }
        }

        return Promise.resolve(pluginDirs);
    }

    /**
     * Load a plugin from directory
     */
    async loadPlugin(pluginDirName: string): Promise<void> {
        const pluginPath = path.join(this.config.pluginDir, pluginDirName);
        const manifestPath = path.join(pluginPath, 'manifest.json');

        // Load manifest
        const manifestData = fs.readFileSync(manifestPath, 'utf-8');
        const manifest: unknown = JSON.parse(manifestData);
        this.validateManifest(manifest);

        // Check if plugin already loaded
        if (this.plugins.has(manifest.id)) {
            throw new Error(`Plugin ${manifest.id} is already loaded`);
        }

        // Check dependencies
        await this.checkDependencies(manifest);

        // Load plugin module
        const indexPath = path.join(pluginPath, 'index.js');
        if (!fs.existsSync(indexPath)) {
            throw new Error(`Plugin ${manifest.id} is missing index.js`);
        }

        let pluginModule: unknown;
        try {
            // The configured plugin directory is an operator-owned CommonJS extension boundary.
            pluginModule = requirePluginModule(indexPath);
        } catch (error) {
            throw new Error(
                `Failed to load plugin ${manifest.id}: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        const pluginCandidate =
            isRecord(pluginModule) && 'default' in pluginModule
                ? pluginModule.default
                : pluginModule;
        if (!isPlugin(pluginCandidate)) {
            throw new Error(
                `Plugin ${manifest.id} does not export a valid plugin`
            );
        }
        const plugin = pluginCandidate;

        // Create plugin context
        const context = this.createPluginContext(manifest);

        // Create plugin instance
        const instance: PluginInstance = {
            plugin,
            state: PluginState.UNINITIALIZED,
            context,
            loadedAt: new Date(),
        };

        this.plugins.set(manifest.id, instance);

        // Initialize plugin
        await this.initializePlugin(manifest.id);

        // Auto-start if configured
        if (this.config.autoStart) {
            await this.startPlugin(manifest.id);
        }
    }

    /**
     * Validate plugin manifest
     */
    private validateManifest(
        manifest: unknown
    ): asserts manifest is PluginManifest {
        if (!isPluginManifest(manifest)) {
            throw new Error('Plugin manifest is invalid');
        }
    }

    /**
     * Check plugin dependencies
     */
    private checkDependencies(manifest: PluginManifest): Promise<void> {
        if (!manifest.dependencies || manifest.dependencies.length === 0) {
            return Promise.resolve();
        }

        for (const depId of manifest.dependencies) {
            if (!this.plugins.has(depId)) {
                throw new Error(
                    `Plugin ${manifest.id} requires dependency ${depId} which is not loaded`
                );
            }
        }

        return Promise.resolve();
    }

    /**
     * Create plugin context with appropriate permissions
     */
    private createPluginContext(manifest: PluginManifest): PluginContext {
        const permissions = manifest.permissions || [];
        const pluginDataDir = path.join(this.config.dataDir, manifest.id);

        // Ensure plugin data directory exists
        if (!fs.existsSync(pluginDataDir)) {
            fs.mkdirSync(pluginDataDir, { recursive: true });
        }

        const context: PluginContext = {
            config: {},
            dataDir: pluginDataDir,
            logger: this.createPluginLogger(manifest.id),
            events: this.createPluginEventEmitter(),
            services: {},
        };

        // Grant permissions
        if (permissions.includes(PluginPermission.DISCORD_CLIENT)) {
            context.discordClient = this.discordClient;
        }

        if (permissions.includes(PluginPermission.API_ROUTES)) {
            context.app = this.app;
        }

        if (permissions.includes(PluginPermission.DATABASE)) {
            context.services.database = db;
        }

        if (permissions.includes(PluginPermission.CACHE)) {
            context.services.cache = getRedisClient();
        }

        if (permissions.includes(PluginPermission.WEBSOCKET)) {
            context.services.websocket = websocketService;
        }

        return context;
    }

    /**
     * Create logger for plugin
     */
    private createPluginLogger(pluginId: string): PluginContext['logger'] {
        return {
            info: (message: string, meta?: Record<string, unknown>) => {
                console.log(`[Plugin:${pluginId}] ${message}`, meta || {});
            },
            warn: (message: string, meta?: Record<string, unknown>) => {
                console.warn(`[Plugin:${pluginId}] ${message}`, meta || {});
            },
            error: (message: string, meta?: Record<string, unknown>) => {
                console.error(`[Plugin:${pluginId}] ${message}`, meta || {});
            },
            debug: (message: string, meta?: Record<string, unknown>) => {
                console.debug(`[Plugin:${pluginId}] ${message}`, meta || {});
            },
        };
    }

    /**
     * Create event emitter for plugin
     */
    private createPluginEventEmitter(): PluginEventEmitter {
        return {
            emit: (event: string, ...args: unknown[]) => {
                this.eventEmitter.emit(event, ...args);
            },
            on: (event: string, listener: (...args: unknown[]) => void) => {
                this.eventEmitter.on(event, listener);
            },
            once: (event: string, listener: (...args: unknown[]) => void) => {
                this.eventEmitter.once(event, listener);
            },
            off: (event: string, listener: (...args: unknown[]) => void) => {
                this.eventEmitter.off(event, listener);
            },
        };
    }

    /**
     * Initialize a plugin
     */
    private async initializePlugin(pluginId: string): Promise<void> {
        const instance = this.plugins.get(pluginId);
        if (!instance) {
            throw new Error(`Plugin ${pluginId} not found`);
        }

        try {
            instance.state = PluginState.INITIALIZING;

            // Call plugin init
            await instance.plugin.init(instance.context);

            // Register hooks if available
            if (instance.plugin.registerHooks) {
                const registry = this.createHookRegistry(pluginId);
                instance.plugin.registerHooks(registry);
            }

            // Register routes if available
            if (instance.plugin.registerRoutes && instance.context.app) {
                const router = Router();
                instance.plugin.registerRoutes(router);
                instance.context.app.use(`/api/plugins/${pluginId}`, router);
            }

            instance.state = PluginState.INITIALIZED;
            instance.context.logger.info(`Plugin initialized successfully`);
        } catch (error) {
            instance.state = PluginState.ERROR;
            instance.error = error as Error;
            instance.context.logger.error(
                `Failed to initialize plugin: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    /**
     * Create hook registry for plugin
     */
    private createHookRegistry(_pluginId: string): PluginHookRegistry {
        return {
            register: (hook: PluginHookType, handler: PluginHookHandler) => {
                if (!this.hooks.has(hook)) {
                    this.hooks.set(hook, []);
                }
                this.hooks.get(hook)!.push(handler);
            },
            unregister: (hook: PluginHookType, handler: PluginHookHandler) => {
                const handlers = this.hooks.get(hook);
                if (handlers) {
                    const index = handlers.indexOf(handler);
                    if (index > -1) {
                        handlers.splice(index, 1);
                    }
                }
            },
        };
    }

    /**
     * Start a plugin
     */
    async startPlugin(pluginId: string): Promise<void> {
        const instance = this.plugins.get(pluginId);
        if (!instance) {
            throw new Error(`Plugin ${pluginId} not found`);
        }

        if (
            instance.state !== PluginState.INITIALIZED &&
            instance.state !== PluginState.STOPPED
        ) {
            throw new Error(
                `Plugin ${pluginId} cannot be started from state ${instance.state}`
            );
        }

        try {
            instance.state = PluginState.STARTING;

            if (instance.plugin.start) {
                await instance.plugin.start();
            }

            instance.state = PluginState.RUNNING;
            instance.context.logger.info(`Plugin started successfully`);
        } catch (error) {
            instance.state = PluginState.ERROR;
            instance.error = error as Error;
            instance.context.logger.error(
                `Failed to start plugin: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    /**
     * Stop a plugin
     */
    async stopPlugin(pluginId: string): Promise<void> {
        const instance = this.plugins.get(pluginId);
        if (!instance) {
            throw new Error(`Plugin ${pluginId} not found`);
        }

        if (instance.state !== PluginState.RUNNING) {
            throw new Error(`Plugin ${pluginId} is not running`);
        }

        try {
            instance.state = PluginState.STOPPING;

            if (instance.plugin.stop) {
                await instance.plugin.stop();
            }

            instance.state = PluginState.STOPPED;
            instance.context.logger.info(`Plugin stopped successfully`);
        } catch (error) {
            instance.state = PluginState.ERROR;
            instance.error = error as Error;
            instance.context.logger.error(
                `Failed to stop plugin: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    /**
     * Unload a plugin
     */
    async unloadPlugin(pluginId: string): Promise<void> {
        const instance = this.plugins.get(pluginId);
        if (!instance) {
            throw new Error(`Plugin ${pluginId} not found`);
        }

        // Stop plugin if running
        if (instance.state === PluginState.RUNNING) {
            await this.stopPlugin(pluginId);
        }

        // Call destroy if available
        if (instance.plugin.destroy) {
            await instance.plugin.destroy();
        }

        // Remove from loaded plugins
        this.plugins.delete(pluginId);
        instance.context.logger.info(`Plugin unloaded successfully`);
    }

    /**
     * Execute hooks for a specific hook type
     */
    async executeHooks<T>(hook: PluginHookType, data: T): Promise<T> {
        const handlers = this.hooks.get(hook) || [];
        let result = data;

        for (const handler of handlers) {
            try {
                const handlerResult = await handler(
                    result,
                    this.createHookContext()
                );
                if (handlerResult !== undefined) {
                    result = handlerResult as T;
                }
            } catch (error) {
                console.error(
                    `Error executing hook ${hook}: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        return result;
    }

    /**
     * Create context for hook execution
     */
    private createHookContext(): PluginContext {
        return {
            config: {},
            dataDir: this.config.dataDir,
            logger: this.createPluginLogger('hook'),
            events: this.createPluginEventEmitter(),
            services: {},
        };
    }

    /**
     * Get all loaded plugins
     */
    getLoadedPlugins(): PluginInstance[] {
        return Array.from(this.plugins.values());
    }

    /**
     * Get plugin by ID
     */
    getPlugin(pluginId: string): PluginInstance | undefined {
        return this.plugins.get(pluginId);
    }

    /**
     * Get plugin health status
     */
    async getPluginHealth(pluginId: string): Promise<{
        healthy: boolean;
        state?: PluginState;
        error?: string;
        message?: string;
        details?: Record<string, unknown>;
    }> {
        const instance = this.plugins.get(pluginId);
        if (!instance) {
            throw new Error(`Plugin ${pluginId} not found`);
        }

        if (instance.plugin.healthCheck) {
            return await instance.plugin.healthCheck();
        }

        return {
            healthy: instance.state === PluginState.RUNNING,
            state: instance.state,
            error: instance.error?.message,
        };
    }

    /**
     * Load all plugins from plugin directory
     */
    async loadAllPlugins(): Promise<void> {
        const pluginDirs = await this.discoverPlugins();

        for (const pluginDir of pluginDirs) {
            try {
                await this.loadPlugin(pluginDir);
            } catch (error) {
                console.error(
                    `Failed to load plugin ${pluginDir}: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    }

    /**
     * Stop all plugins
     */
    async stopAllPlugins(): Promise<void> {
        for (const [pluginId, instance] of this.plugins) {
            if (instance.state === PluginState.RUNNING) {
                try {
                    await this.stopPlugin(pluginId);
                } catch (error) {
                    console.error(
                        `Failed to stop plugin ${pluginId}: ${
                            error instanceof Error
                                ? error.message
                                : String(error)
                        }`
                    );
                }
            }
        }
    }
}

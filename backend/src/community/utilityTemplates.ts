import { z } from 'zod';

const template = z
    .string()
    .refine(
        (text) =>
            [...text.matchAll(/\{([^{}]+)\}/g)].every((match) =>
                ['user', 'server', 'channel'].includes(match[1])
            ),
        'Use only {user}, {server} and {channel} substitutions'
    );
export const customResponse = z
    .object({
        content: template.pipe(z.string().max(1800)).default(''),
        title: template.pipe(z.string().max(200)).default(''),
        description: template.pipe(z.string().max(3500)).default(''),
    })
    .strict()
    .refine(
        (response) =>
            !!(
                response.content.trim() ||
                response.title.trim() ||
                response.description.trim()
            ),
        'A response is required'
    );
export const customCommandsConfig = z
    .object({
        commands: z
            .array(
                z
                    .object({
                        name: z.string().regex(/^[a-z0-9_-]{1,32}$/),
                        response: customResponse,
                        requiredRoles: z
                            .array(z.string().regex(/^\d{17,20}$/))
                            .max(5)
                            .default([]),
                    })
                    .strict()
            )
            .max(20)
            .default([]),
    })
    .strict()
    .refine(
        (config) =>
            new Set(config.commands.map((command) => command.name)).size ===
            config.commands.length,
        'Duplicate command names'
    );
export function renderCustomResponse(
    input: z.input<typeof customResponse>,
    values: { user: string; server: string; channel: string }
) {
    const response = customResponse.parse(input);
    const render = (text: string, limit: number) =>
        text
            .replace(
                /\{(user|server|channel)\}/g,
                (_, key: keyof typeof values) =>
                    key === 'user'
                        ? values.user
                        : key === 'server'
                          ? values.server
                          : values.channel
            )
            .slice(0, limit);
    const content = render(response.content, 2000),
        title = render(response.title, 256),
        description = render(response.description, 4096);
    return {
        ...(content ? { content } : {}),
        ...(title || description
            ? {
                  embeds: [
                      {
                          ...(title ? { title } : {}),
                          ...(description ? { description } : {}),
                      },
                  ],
              }
            : {}),
        allowedMentions: {
            parse: [] as ('users' | 'roles' | 'everyone')[],
            repliedUser: false,
        },
    };
}

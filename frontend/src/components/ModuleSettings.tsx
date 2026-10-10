import AntiSpamConfig from './AntiSpamConfig';
import AudioClips from './AudioClips';
import AudioConfig from './AudioConfig';
import AudioQueue from './AudioQueue';
import BirthdaysConfig from './BirthdaysConfig';
import CommunityReportsConfig from './CommunityReportsConfig';
import CustomCommandsConfig from './CustomCommandsConfig';
import EconomyConfig from './EconomyConfig';
import EntertainmentConfig from './EntertainmentConfig';
import GiveawayConfig from './GiveawayConfig';
import LevelingConfig from './LevelingConfig';
import OnboardingConfig from './OnboardingConfig';
import ProviderHistory from './ProviderHistory';
import RecoveryConfig from './RecoveryConfig';
import RecurringAnnouncementsHistory from './RecurringAnnouncementsHistory';
import RestoreHistory from './RestoreHistory';
import ScheduledUtilitiesHistory from './ScheduledUtilitiesHistory';
import SelfRolesConfig from './SelfRolesConfig';
import ServerModuleConfig from './ServerModuleConfig';
import SuggestionsConfig from './SuggestionsConfig';
import TicketConfig from './TicketConfig';
import WorkflowsConfig from './WorkflowsConfig';

export type ModuleRecord = {
    id: string;
    description: string;
    operatorReady: boolean;
    permissions: string[];
    intents: number[];
    settings: { enabled: boolean; config: Record<string, unknown> };
};

type Props = {
    guildId: string;
    module: ModuleRecord;
    /** Reloads module state after a save; the optional notice is shown at page level. */
    onSaved: (notice?: string) => Promise<void>;
    onBusy: (value: boolean) => void;
};

export default function ModuleSettings({
    guildId,
    module,
    onSaved,
    onBusy,
}: Props) {
    const enabled = module.settings.enabled;
    const config = module.settings.config;
    const configKey = `${guildId}:${module.id}:${JSON.stringify(config)}`;
    const shared = { guildId, enabled, config, onBusy };
    switch (module.id) {
        case 'polls':
            return (
                <p className="text-sm">
                    Use /poll create in a server text channel with a question
                    and two to ten answers separated by |. Managers can create
                    or close Backline polls; members can use /poll results.
                    Voting happens in Discord. Backline needs Send Polls and
                    Read Message History in the destination. Queued actions
                    require delivery confirmation in the channel.
                </p>
            );
        case 'afk':
            return (
                <p className="text-sm">
                    Use /afk set to share a temporary away reason, /afk clear to
                    remove it, or /afk status to read a member’s current status.
                    Reasons expire within twenty-four hours and clear when the
                    member speaks. Mention notices are limited to five members
                    per message and throttled; they do not send notification
                    mentions.
                </p>
            );
        case 'scheduled-utilities':
            return (
                <>
                    <ScheduledUtilitiesHistory
                        key={`${guildId}:scheduled-utilities`}
                        guildId={guildId}
                    />
                    <RecurringAnnouncementsHistory
                        key={`${guildId}:recurring-announcements`}
                        guildId={guildId}
                    />
                </>
            );
        case 'integrations':
            return (
                <ProviderHistory
                    key={`${guildId}:integrations`}
                    guildId={guildId}
                />
            );
        case 'workflows':
            return (
                <WorkflowsConfig
                    key={configKey}
                    {...shared}
                    onSaved={() => onSaved()}
                />
            );
        case 'entertainment':
            return (
                <EntertainmentConfig
                    key={configKey}
                    {...shared}
                    onSaved={() => onSaved()}
                />
            );
        case 'economy':
            return (
                <EconomyConfig
                    key={configKey}
                    {...shared}
                    onSaved={() => onSaved()}
                />
            );
        case 'recovery':
            return (
                <>
                    <RecoveryConfig
                        key={configKey}
                        {...shared}
                        onSaved={() => onSaved()}
                    />
                    <RestoreHistory
                        key={`${guildId}:restore-history`}
                        guildId={guildId}
                    />
                </>
            );
        case 'audio':
            return (
                <>
                    <AudioConfig
                        key={configKey}
                        {...shared}
                        onSaved={() => onSaved()}
                    />
                    <AudioQueue
                        key={`${guildId}:audio-queue`}
                        guildId={guildId}
                        onBusy={onBusy}
                    />
                    <AudioClips
                        key={`${guildId}:audio-clips`}
                        guildId={guildId}
                        onBusy={onBusy}
                    />
                </>
            );
        case 'birthdays':
            return (
                <BirthdaysConfig
                    key={configKey}
                    {...shared}
                    onSaved={() => onSaved()}
                />
            );
        case 'suggestions':
            return (
                <SuggestionsConfig
                    key={configKey}
                    {...shared}
                    onSaved={() => onSaved()}
                />
            );
        case 'custom-commands':
            return (
                <CustomCommandsConfig
                    key={configKey}
                    {...shared}
                    onSaved={() => onSaved()}
                />
            );
        case 'community-reports':
            return (
                <CommunityReportsConfig
                    key={configKey}
                    {...shared}
                    onSaved={() => onSaved()}
                />
            );
        case 'leveling':
            return (
                <LevelingConfig
                    key={configKey}
                    {...shared}
                    onSaved={() => onSaved()}
                />
            );
        case 'giveaways':
            return (
                <GiveawayConfig
                    key={configKey}
                    {...shared}
                    onSaved={() => onSaved()}
                />
            );
        case 'tickets':
            return (
                <TicketConfig
                    key={configKey}
                    {...shared}
                    onSaved={() => onSaved()}
                />
            );
        case 'onboarding':
            return (
                <OnboardingConfig
                    key={configKey}
                    {...shared}
                    onSaved={() =>
                        onSaved('Onboarding settings saved for this server.')
                    }
                />
            );
        case 'self-roles':
            return (
                <SelfRolesConfig
                    key={configKey}
                    {...shared}
                    onSaved={() =>
                        onSaved('Role settings saved for this server.')
                    }
                />
            );
        case 'anti-spam':
            return (
                <AntiSpamConfig
                    key={configKey}
                    {...shared}
                    onSaved={() =>
                        onSaved('Anti-spam policy saved for this server.')
                    }
                />
            );
        case 'audit-log':
            return (
                <ServerModuleConfig
                    key={`audit-config:${configKey}`}
                    {...shared}
                    moduleId={module.id}
                    onSaved={() =>
                        onSaved('Log settings saved for this server.')
                    }
                />
            );
        default:
            return null;
    }
}

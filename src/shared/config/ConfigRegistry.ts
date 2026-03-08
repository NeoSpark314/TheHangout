export type ConfigType = 'key-value-list';

export interface IConfigSchema {
    id: string;
    title: string;
    description?: string;
    type: ConfigType;
    defaultTarget?: string; // used for auto-populating e.g. a default value for key/value
}

export interface IConfigKeyValue {
    name: string;
    value: string;
}

export class ConfigRegistry {
    private static schemas: Map<string, IConfigSchema> = new Map();

    public static register(schema: IConfigSchema): void {
        this.schemas.set(schema.id, schema);
    }

    public static getSchemas(): IConfigSchema[] {
        return Array.from(this.schemas.values());
    }

    public static getSchema(id: string): IConfigSchema | undefined {
        return this.schemas.get(id);
    }

    // Storage hooks
    private static getStorageKey(schemaId: string): string {
        return `hangout_ext_${schemaId}`;
    }

    public static getKeyValueList(schemaId: string): IConfigKeyValue[] {
        const raw = localStorage.getItem(this.getStorageKey(schemaId));
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.map((item) => ({
                name: String(item.name || '').trim(),
                value: String(item.value || '').trim()
            })).filter(item => item.name.length > 0 && item.value.length > 0);
        } catch {
            return [];
        }
    }

    public static setKeyValueList(schemaId: string, list: IConfigKeyValue[]): void {
        const cleaned = list.map(item => ({
            name: String(item.name || '').trim(),
            value: String(item.value || '').trim()
        })).filter(item => item.name.length > 0 && item.value.length > 0);

        localStorage.setItem(this.getStorageKey(schemaId), JSON.stringify(cleaned));
    }
}

import keytar from 'keytar'

const SERVICE = 'strata'

export const saveSecret = (key: string, val: string): Promise<void> =>
  keytar.setPassword(SERVICE, key, val)

export const getSecret = (key: string): Promise<string | null> =>
  keytar.getPassword(SERVICE, key)

export const deleteSecret = (key: string): Promise<boolean> =>
  keytar.deletePassword(SERVICE, key)

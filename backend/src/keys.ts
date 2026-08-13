/** DynamoDB 単一テーブルのパーティションキー。GAME# と USER# を同居させる。 */

export const gamePk = (id: string): string => `GAME#${id}`
export const userPk = (sub: string): string => `USER#${sub}`

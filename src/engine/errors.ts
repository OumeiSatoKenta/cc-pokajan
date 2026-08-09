/**
 * エンジン層で共有する例外型。
 *
 * ロスター検証の `RosterValidationError` のように1つのモジュールしか投げない例外は
 * そのモジュールに置いているが、こちらは状態機械・割り込み解決の複数モジュールが投げるため
 * 独立させている。
 */

/**
 * そのフェーズでは受け付けられないアクションが渡されたときの例外。
 *
 * 不正なアクションを黙って無視すると、UI のバグが「何も起きない」という形で隠れてしまう。
 * 進行不能な入力は必ず表面化させる。
 */
export class IllegalActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IllegalActionError'
  }
}

import { action } from "mobx";

import { requestJson, requestVoid } from "../api";
import { BaseStore } from "../common/BaseStore";
import * as config from "../config";
import { SnackReporter } from "../snack/SnackManager";
import { IUser } from "../types";

export class UserStore extends BaseStore<IUser> {
	constructor(private readonly snack: SnackReporter) {
		super();
	}

	protected requestItems = (): Promise<IUser[]> => requestJson<IUser[]>(`${config.get("url")}user`);

	protected requestDelete(id: number): Promise<void> {
		return requestVoid(`${config.get("url")}user/${id}`, { method: "DELETE" }).then(() => this.snack("User deleted"));
	}

	@action
	public create = async (name: string, pass: string, admin: boolean) => {
		await requestVoid(`${config.get("url")}user`, {
			method: "POST",
			body: { name, pass, admin },
		});
		await this.refresh();
		this.snack("User created");
	};

	@action
	public update = async (id: number, name: string, pass: string | null, admin: boolean) => {
		await requestVoid(config.get("url") + "user/" + id, {
			method: "POST",
			body: { name, pass, admin },
		});
		await this.refresh();
		this.snack("User updated");
	};
}

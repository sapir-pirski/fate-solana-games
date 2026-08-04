ALTER TABLE `games` ADD `chain_address` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `games` SET `chain_address`=`address` WHERE `chain_address`='';--> statement-breakpoint
CREATE INDEX `games_chain_address_idx` ON `games` (`chain_address`,`last_slot`);

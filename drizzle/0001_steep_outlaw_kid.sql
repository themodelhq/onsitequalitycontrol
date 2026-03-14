CREATE TABLE `analysisBatches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`fileName` varchar(500),
	`totalProducts` int,
	`productsAnalyzed` int DEFAULT 0,
	`issuesFound` int DEFAULT 0,
	`status` enum('pending','analyzing','completed','failed') DEFAULT 'pending',
	`errorMessage` text,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `analysisBatches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `analysisResults` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productId` int NOT NULL,
	`issueType` enum('poor_image_quality','insufficient_images','non_white_background','poor_description','missing_description_images','naming_format_violation','prohibited_item','blacklisted_keyword','restricted_brand','wrong_category','sensitive_category','counterfeit_indicator') NOT NULL,
	`severity` enum('low','medium','high','critical') NOT NULL,
	`country` enum('NG','EG','MA','KE','UG','GH','CI','TN','SN','DZ','IC') NOT NULL,
	`details` json,
	`recommendation` text,
	`resolved` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `analysisResults_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `blacklistedKeywords` (
	`id` int AUTO_INCREMENT NOT NULL,
	`keyword` varchar(500) NOT NULL,
	`category` varchar(255),
	`countries` text,
	`severity` enum('low','medium','high','critical') DEFAULT 'high',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `blacklistedKeywords_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `namingFormats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`categoryName` varchar(255) NOT NULL,
	`format` text NOT NULL,
	`example` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `namingFormats_id` PRIMARY KEY(`id`),
	CONSTRAINT `namingFormats_categoryName_unique` UNIQUE(`categoryName`)
);
--> statement-breakpoint
CREATE TABLE `productImages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productId` int NOT NULL,
	`imageUrl` varchar(1000) NOT NULL,
	`position` int,
	`width` int,
	`height` int,
	`resolution` varchar(50),
	`backgroundColorHex` varchar(7),
	`isWhiteBackground` boolean,
	`isLowResolution` boolean,
	`analysisStatus` enum('pending','analyzing','completed','failed') DEFAULT 'pending',
	`analysisError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `productImages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`sku` varchar(255) NOT NULL,
	`name` varchar(500) NOT NULL,
	`brand` varchar(255),
	`category` varchar(255) NOT NULL,
	`country` enum('NG','EG','MA','KE','UG','GH','CI','TN','SN','DZ','IC') NOT NULL,
	`price` decimal(12,2),
	`oldPrice` decimal(12,2),
	`description` longtext,
	`seller` varchar(255),
	`isJumiaExpress` boolean DEFAULT false,
	`isShopGlobal` boolean DEFAULT false,
	`rating` decimal(3,2),
	`totalRatings` int,
	`stock` varchar(100),
	`tags` text,
	`sourceUrl` varchar(1000),
	`rawData` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prohibitedItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`keyword` varchar(500) NOT NULL,
	`category` varchar(255),
	`countries` text,
	`status` enum('blocked','open','licensed','registered','verified_sellers_only') DEFAULT 'blocked',
	`details` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `prohibitedItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `restrictedBrands` (
	`id` int AUTO_INCREMENT NOT NULL,
	`brand` varchar(255) NOT NULL,
	`category` varchar(255),
	`countries` text,
	`restrictionType` enum('blocked','licensed','registered','verified_sellers_only') DEFAULT 'blocked',
	`details` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `restrictedBrands_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sensitiveCategories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`categoryName` varchar(255) NOT NULL,
	`countries` text,
	`restrictions` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sensitiveCategories_id` PRIMARY KEY(`id`)
);

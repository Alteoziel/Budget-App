# Minimal Terraform stub — Layer E (IaC learning surface).
# Expand when cloud infra for the Budget App is defined. CI runs Checkov here.

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type        = string
  description = "AWS region for Budget App infrastructure"
  default     = "us-east-1"
}

variable "project_name" {
  type        = string
  description = "Name prefix for Budget App resources"
  default     = "budget-app"
}

# Placeholder root module so Checkov has a valid scan target.
resource "aws_cloudwatch_log_group" "api" {
  name              = "/${var.project_name}/api"
  retention_in_days = 365
}

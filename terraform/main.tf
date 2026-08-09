terraform {
  required_version = ">= 1.7.0"
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.31"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.14"
    }
  }
}

variable "namespace" {
  type    = string
  default = "goanalyze-government"
}

resource "kubernetes_namespace" "goanalyze" {
  metadata {
    name = var.namespace
    labels = {
      "pod-security.kubernetes.io/enforce" = "restricted"
      "app.kubernetes.io/part-of"          = "goanalyze-government"
    }
  }
}

resource "helm_release" "goanalyze" {
  name      = "goanalyze-government"
  namespace = kubernetes_namespace.goanalyze.metadata[0].name
  chart     = "../helm/goanalyze-government"

  values = [
    file("${path.module}/values/goanalyze-values.yaml")
  ]
}

